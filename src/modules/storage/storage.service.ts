import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import { dirname, join } from 'path';
import { finished } from 'stream/promises';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

type StorageCode =
  | 'STORAGE_CONNECTION_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_DELETE_FAILED';

@Injectable()
export class StorageService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StorageService.name);
  private client?: MongoClient;
  private bucket?: GridFSBucket;
  private dbName?: string;

  constructor(private readonly config: ConfigService) {}

  private get driver(): 'gridfs' | 'local' {
    return this.config.get<string>('STORAGE_DRIVER') === 'local' ? 'local' : 'gridfs';
  }

  private get bucketName(): string {
    return this.config.get<string>('GRIDFS_BUCKET') ?? 'maryme_storage';
  }

  async onModuleInit(): Promise<void> {
    if (this.driver === 'local') {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          'Local storage is forbidden in production; configure STORAGE_DRIVER=gridfs',
        );
      }
      return;
    }
    try {
      const uri = this.config.getOrThrow<string>('DATABASE_URL');
      this.client = new MongoClient(uri);
      await this.client.connect();
      const db = this.client.db();
      this.dbName = db.databaseName;
      await db.command({ ping: 1 });
      this.bucket = new GridFSBucket(db, { bucketName: this.bucketName });
      await db
        .collection(`${this.bucketName}.files`)
        .createIndex({ 'metadata.key': 1 }, { unique: true });
    } catch {
      await this.client?.close().catch(() => undefined);
      this.client = undefined;
      this.bucket = undefined;
      this.logger.error('STORAGE_CONNECTION_FAILED: MongoDB GridFS initialization failed');
      throw new Error('STORAGE_CONNECTION_FAILED: required MongoDB GridFS storage is unavailable');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.bucket = undefined;
  }

  private failure(code: StorageCode, message: string): InternalServerErrorException {
    return new InternalServerErrorException({ code, message });
  }

  private requireBucket(): GridFSBucket {
    if (!this.bucket || !this.client)
      throw this.failure('STORAGE_CONNECTION_FAILED', 'Invitation storage is unavailable');
    return this.bucket;
  }

  async status() {
    if (this.driver === 'local') {
      return {
        backend: 'local-filesystem',
        persistent: false,
        connected: true,
        bucket: null,
        warning: 'Local storage is intended for development and tests only.',
      };
    }
    let connected = false;
    try {
      await this.client?.db(this.dbName).command({ ping: 1 });
      connected = Boolean(this.bucket);
    } catch {
      this.logger.error('STORAGE_CONNECTION_FAILED: MongoDB GridFS health ping failed');
    }
    return {
      backend: 'mongodb-gridfs',
      persistent: true,
      connected,
      bucket: this.bucketName,
      warning: connected ? null : 'MongoDB GridFS storage is unavailable.',
    };
  }

  private localPath(key: string): string {
    return join(this.config.get<string>('STORAGE_LOCAL_DIR') ?? '.storage', key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.driver === 'local') {
      const path = this.localPath(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
      await writeFile(`${path}.content-type`, contentType);
      return;
    }
    try {
      const upload = this.requireBucket().openUploadStream(key, {
        metadata: { key, contentType },
        contentType,
      });
      upload.end(body);
      await finished(upload);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw this.failure('STORAGE_WRITE_FAILED', 'Unable to store invitation background');
    }
  }

  async get(key: string): Promise<StoredObject> {
    if (this.driver === 'local') {
      try {
        return {
          body: await readFile(this.localPath(key)),
          contentType: (await readFile(`${this.localPath(key)}.content-type`, 'utf8')).trim(),
        };
      } catch {
        throw new NotFoundException({
          code: 'STORAGE_OBJECT_NOT_FOUND',
          message: 'Stored object not found',
        });
      }
    }
    try {
      const bucket = this.requireBucket();
      const file = await bucket.find({ 'metadata.key': key }).next();
      if (!file)
        throw new NotFoundException({
          code: 'STORAGE_OBJECT_NOT_FOUND',
          message: 'Stored object not found',
        });
      const chunks: Buffer[] = [];
      const stream = bucket.openDownloadStream(file._id as ObjectId);
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      await finished(stream);
      return {
        body: Buffer.concat(chunks),
        contentType:
          (file.metadata?.contentType as string | undefined) ??
          file.contentType ??
          'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof InternalServerErrorException)
        throw error;
      throw this.failure('STORAGE_READ_FAILED', 'Unable to read stored object');
    }
  }

  async delete(key: string): Promise<void> {
    if (this.driver === 'local') {
      await Promise.all([
        unlink(this.localPath(key)).catch(() => undefined),
        unlink(`${this.localPath(key)}.content-type`).catch(() => undefined),
      ]);
      return;
    }
    try {
      const bucket = this.requireBucket();
      const file = await bucket.find({ 'metadata.key': key }).next();
      if (file) await bucket.delete(file._id as ObjectId);
    } catch (error) {
      if (error instanceof InternalServerErrorException) throw error;
      throw this.failure('STORAGE_DELETE_FAILED', 'Unable to delete stored object');
    }
  }
}

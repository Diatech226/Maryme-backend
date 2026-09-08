import { Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'production' && !this.hasPersistentConfig()) {
      this.logger.warn(
        'WARNING: complete persistent object storage configuration is missing; local invitation files may be lost after restart/deploy. Configure STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY.',
      );
    }
  }

  private hasPersistentConfig(): boolean {
    return [
      'STORAGE_ENDPOINT',
      'STORAGE_REGION',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
    ].every((name) => !!this.config.get<string>(name));
  }

  status() {
    const persistent = this.hasPersistentConfig();
    return {
      backend: persistent ? 's3-compatible' : 'local-filesystem',
      persistent,
      warning:
        this.config.get<string>('NODE_ENV') === 'production' && !persistent
          ? 'Persistent invitation storage is not configured; uploaded backgrounds may be lost during deployment.'
          : null,
    };
  }

  private get endpoint(): string | undefined {
    return this.config.get<string>('STORAGE_ENDPOINT');
  }
  private get bucket(): string {
    return this.config.get<string>('STORAGE_BUCKET') ?? 'maryme-private';
  }
  private localPath(key: string): string {
    return join(this.config.get<string>('STORAGE_LOCAL_DIR') ?? '.storage', this.bucket, key);
  }
  private hmac(key: Buffer | string, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest();
  }
  private sha(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  private async s3(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<Response> {
    const endpoint = this.endpoint!;
    const region = this.config.get<string>('STORAGE_REGION') ?? 'us-east-1';
    const accessKey = this.config.getOrThrow<string>('STORAGE_ACCESS_KEY_ID');
    const secret = this.config.getOrThrow<string>('STORAGE_SECRET_ACCESS_KEY');
    const path = `/${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
    const url = new URL(path, endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    const now = new Date();
    const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = stamp.slice(0, 8);
    const payloadHash = this.sha(body ?? Buffer.alloc(0));
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': stamp,
    };
    if (method === 'PUT') headers['content-type'] = contentType;
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalHeaders = Object.keys(headers)
      .sort()
      .map((name) => `${name}:${headers[name].trim()}\n`)
      .join('');
    const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join(
      '\n',
    );
    const scope = `${date}/${region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${this.sha(canonical)}`;
    const dateKey = this.hmac(`AWS4${secret}`, date);
    const signature = createHmac(
      'sha256',
      this.hmac(this.hmac(this.hmac(dateKey, region), 's3'), 'aws4_request'),
    )
      .update(stringToSign)
      .digest('hex');
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });
    if (!response.ok)
      throw new InternalServerErrorException(`Object storage request failed (${response.status})`);
    return response;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.endpoint) {
      await this.s3('PUT', key, body, contentType);
      return;
    }
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await writeFile(`${path}.content-type`, contentType);
  }
  async get(key: string): Promise<StoredObject> {
    if (this.endpoint) {
      const response = await this.s3('GET', key);
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    }
    return {
      body: await readFile(this.localPath(key)),
      contentType: (await readFile(`${this.localPath(key)}.content-type`, 'utf8')).trim(),
    };
  }
  async delete(key: string): Promise<void> {
    if (this.endpoint) {
      await this.s3('DELETE', key);
      return;
    }
    await Promise.all([
      unlink(this.localPath(key)).catch(() => undefined),
      unlink(`${this.localPath(key)}.content-type`).catch(() => undefined),
    ]);
  }
}

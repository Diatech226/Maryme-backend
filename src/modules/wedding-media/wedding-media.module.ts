import { Module } from '@nestjs/common';
import { WeddingMediaController } from './wedding-media.controller';
import { WeddingMediaService } from './wedding-media.service';

@Module({ controllers: [WeddingMediaController], providers: [WeddingMediaService] })
export class WeddingMediaModule {}

import { Module } from '@nestjs/common';
import { InvitationDesignsController } from './invitation-designs.controller';
import { InvitationDesignsService } from './invitation-designs.service';
@Module({ controllers: [InvitationDesignsController], providers: [InvitationDesignsService] })
export class InvitationDesignsModule {}

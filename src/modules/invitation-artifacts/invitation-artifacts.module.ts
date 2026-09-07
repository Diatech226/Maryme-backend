import { Module } from '@nestjs/common';
import {
  InvitationArtifactsController,
  PublicInvitationSharesController,
} from './invitation-artifacts.controller';
import { InvitationArtifactsService } from './invitation-artifacts.service';
@Module({
  controllers: [InvitationArtifactsController, PublicInvitationSharesController],
  providers: [InvitationArtifactsService],
})
export class InvitationArtifactsModule {}

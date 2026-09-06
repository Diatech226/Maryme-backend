import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckInsService } from './checkins.service';
import { CheckInQueryDto, CreateCheckInDto, ValidateCheckInDto } from './dto/checkin.dto';
@ApiTags('CheckIns') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller()
export class CheckInsController {
  constructor(private readonly service:CheckInsService){}
  @Post('checkins/validate') @Throttle({default:{limit:60,ttl:60000}}) validate(@Body()dto:ValidateCheckInDto,@CurrentUser()user:AuthUser){return this.service.validate(dto.token,user)}
  @Post('checkins') create(@Body()dto:CreateCheckInDto,@CurrentUser()user:AuthUser){return this.service.create(dto,user)}
  @Get('couples/:coupleId/checkins') list(@Param('coupleId')coupleId:string,@Query()query:CheckInQueryDto,@CurrentUser()user:AuthUser){return this.service.list(coupleId,query,user)}
}

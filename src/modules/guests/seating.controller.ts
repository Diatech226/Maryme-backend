import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AssignSeatingDto, BulkSeatingDto } from './dto/seating.dto';
import { SeatingService } from './seating.service';

@ApiTags('Seating')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller('couples/:coupleId')
export class SeatingController {
  constructor(private readonly seating: SeatingService) {}

  @Post('seating/initialize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Idempotently create missing tables 1 through 40 (capacity 10)' })
  @ApiResponse({ status: 200, description: 'The current seating availability' })
  initialize(@Param('coupleId') coupleId: string, @CurrentUser() user: AuthUser) {
    return this.seating.initialize(coupleId, user);
  }

  @Get('seating/availability')
  @ApiOperation({ summary: 'List the real occupied and selectable physical seats' })
  availability(@Param('coupleId') coupleId: string, @CurrentUser() user: AuthUser) {
    return this.seating.availability(coupleId, user);
  }

  @Put('guests/:guestId/seating')
  @ApiOperation({ summary: 'Assign or atomically move one guest' })
  @ApiBody({
    schema: {
      oneOf: [
        { example: { tableId: '66d8f84fb06a707fa0e90411', seatNumbers: [1, 2, 3] } },
        { example: { tableId: '66d8f84fb06a707fa0e90411', autoAssign: true } },
      ],
    },
  })
  assign(
    @Param('coupleId') coupleId: string,
    @Param('guestId') guestId: string,
    @Body() dto: AssignSeatingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.seating.assign(coupleId, guestId, dto, user);
  }

  @Delete('guests/:guestId/seating')
  @ApiOperation({ summary: 'Release every physical seat assigned to one guest' })
  unassign(
    @Param('coupleId') coupleId: string,
    @Param('guestId') guestId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.seating.unassign(coupleId, guestId, user);
  }

  @Post('tables/:tableId/seating/bulk')
  @ApiOperation({ summary: 'Atomically assign up to 10 guests to one table' })
  @ApiBody({
    schema: {
      oneOf: [
        { example: { guestIds: ['guest1', 'guest2'], autoAssign: true } },
        {
          example: {
            assignments: [
              { guestId: 'guest1', seatNumbers: [1, 2] },
              { guestId: 'guest2', seatNumbers: [3] },
            ],
          },
        },
      ],
    },
  })
  bulk(
    @Param('coupleId') coupleId: string,
    @Param('tableId') tableId: string,
    @Body() dto: BulkSeatingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.seating.bulk(coupleId, tableId, dto, user);
  }
}

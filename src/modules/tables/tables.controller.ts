import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthUser } from '../../common/types/auth-user';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AssignGuestTableDto,
  BulkWeddingTablesDto,
  ConfigureWeddingTablesDto,
  CreateWeddingTableDto,
  GenerateWeddingTablesDto,
  UpdateWeddingTableDto,
} from './dto/table.dto';
import { TablesService } from './tables.service';
@ApiTags('Wedding tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller('couples/:coupleId/tables')
export class TablesController {
  constructor(private readonly service: TablesService) {}
  @Get() list(@Param('coupleId') c: string, @CurrentUser() u: AuthUser) {
    return this.service.list(c, u);
  }
  @Get('summary') summary(@Param('coupleId') c: string, @CurrentUser() u: AuthUser) {
    return this.service.summary(c, u);
  }
  @Post() create(
    @Param('coupleId') c: string,
    @Body() d: CreateWeddingTableDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.create(c, d, u);
  }
  @Post('bulk') bulk(
    @Param('coupleId') c: string,
    @Body() d: BulkWeddingTablesDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.bulk(c, d, u);
  }
  @Post('generate') generate(
    @Param('coupleId') c: string,
    @Body() d: GenerateWeddingTablesDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.generate(c, d, u);
  }
  @Put('configuration') configuration(
    @Param('coupleId') c: string,
    @Body() d: ConfigureWeddingTablesDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.configure(c, d, u);
  }
  @Patch(':tableId') update(
    @Param('coupleId') c: string,
    @Param('tableId') id: string,
    @Body() d: UpdateWeddingTableDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.update(c, id, d, u);
  }
  @Delete(':tableId') @HttpCode(204) remove(
    @Param('coupleId') c: string,
    @Param('tableId') id: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.remove(c, id, u);
  }
}

@ApiTags('Wedding tables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.COUPLE)
@Controller('couples/:coupleId/guests')
export class GuestTableAssignmentController {
  constructor(private readonly service: TablesService) {}

  @Patch(':guestId/table')
  assignOrUnassign(
    @Param('coupleId') coupleId: string,
    @Param('guestId') guestId: string,
    @Body() dto: AssignGuestTableDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.assign(coupleId, guestId, dto, user);
  }
}

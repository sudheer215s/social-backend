import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import {
  JwtAuthGuard,
  type IdentityAuthedRequest,
} from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReportsService } from './reports.service';
import {
  createReportSchema,
  listReportsQuerySchema,
  updateReportStatusSchema,
  type CreateReportInput,
  type ListReportsQuery,
  type UpdateReportStatusInput,
} from './reports.validation';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('v1/reports')
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: IdentityAuthedRequest,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ) {
    const report = await this.reports.create(req.userId!, body);
    return { report };
  }

  /** Admin: list reports by status (default open). */
  @Get('v1/admin/reports')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async list(
    @Query(new ZodValidationPipe(listReportsQuerySchema))
    query: ListReportsQuery,
  ) {
    const reports = await this.reports.list(query);
    return { reports };
  }

  /** Admin: update report status (reviewing / resolved / dismissed). */
  @Patch('v1/admin/reports/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async updateStatus(
    @Req() req: IdentityAuthedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReportStatusSchema))
    body: UpdateReportStatusInput,
  ) {
    const report = await this.reports.updateStatus(id, req.userId!, body);
    return { report };
  }
}

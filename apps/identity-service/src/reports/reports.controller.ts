import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  type IdentityAuthedRequest,
} from '../auth/jwt-auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReportsService } from './reports.service';
import {
  createReportSchema,
  type CreateReportInput,
} from './reports.validation';

@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Req() req: IdentityAuthedRequest,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ) {
    const report = await this.reports.create(req.userId!, body);
    return { report };
  }
}

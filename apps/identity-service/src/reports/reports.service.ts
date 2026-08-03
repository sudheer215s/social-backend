import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import type {
  CreateReportInput,
  ListReportsQuery,
  UpdateReportStatusInput,
} from './reports.validation';

export interface AbuseReportDto {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string;
  status: string;
  createdAt: Date;
  reviewedBy?: string | null;
  reviewedAt?: Date | null;
  reviewNote?: string | null;
}

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: string;
  target_id: string;
  reason: string;
  details: string;
  status: string;
  created_at: Date;
  reviewed_by?: string | null;
  reviewed_at?: Date | null;
  review_note?: string | null;
};

function mapRow(r: ReportRow): AbuseReportDto {
  return {
    id: r.id,
    reporterId: r.reporter_id,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.created_at,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
    reviewNote: r.review_note ?? null,
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly pool: Pool) {}

  async create(
    reporterId: string,
    input: CreateReportInput,
  ): Promise<AbuseReportDto> {
    if (input.targetType === 'user' && input.targetId === reporterId) {
      throw new BadRequestException('Cannot report yourself');
    }

    // Rate limit: max N reports per hour per reporter
    const limit = Number(process.env.REPORT_RATE_LIMIT ?? 20);
    const windowHours = Number(process.env.REPORT_RATE_WINDOW_HOURS ?? 1);
    const cap = Number.isFinite(limit) && limit > 0 ? limit : 20;
    const hours =
      Number.isFinite(windowHours) && windowHours > 0
        ? Math.min(windowHours, 24)
        : 1;

    const recent = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM identity.abuse_reports
       WHERE reporter_id = $1
         AND created_at > now() - ($2::text || ' hours')::interval`,
      [reporterId, String(hours)],
    );
    if (Number(recent.rows[0]?.c ?? 0) >= cap) {
      throw new HttpException(
        {
          type: 'https://api.social.example.com/problems/report-rate-limited',
          title: 'Too Many Reports',
          status: 429,
          detail: `Report limit of ${cap} per ${hours}h exceeded`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Dedup open report same target within window
    const dup = await this.pool.query(
      `SELECT 1 FROM identity.abuse_reports
       WHERE reporter_id = $1
         AND target_type = $2
         AND target_id = $3
         AND status = 'open'
         AND created_at > now() - interval '24 hours'
       LIMIT 1`,
      [reporterId, input.targetType, input.targetId],
    );
    if ((dup.rowCount ?? 0) > 0) {
      throw new BadRequestException({
        type: 'https://api.social.example.com/problems/duplicate-report',
        title: 'Already reported',
        status: 400,
        detail: 'You already have an open report for this target',
      });
    }

    const id = uuidv7();
    const row = await this.pool.query<ReportRow>(
      `INSERT INTO identity.abuse_reports
         (id, reporter_id, target_type, target_id, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, reporter_id, target_type, target_id, reason, details, status, created_at,
                 reviewed_by, reviewed_at, review_note`,
      [
        id,
        reporterId,
        input.targetType,
        input.targetId,
        input.reason,
        input.details ?? '',
      ],
    );
    return mapRow(row.rows[0]!);
  }

  async list(query: ListReportsQuery): Promise<AbuseReportDto[]> {
    const row = await this.pool.query<ReportRow>(
      `SELECT id, reporter_id, target_type, target_id, reason, details, status, created_at,
              reviewed_by, reviewed_at, review_note
       FROM identity.abuse_reports
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [query.status, query.limit],
    );
    return row.rows.map(mapRow);
  }

  async updateStatus(
    reportId: string,
    reviewerId: string,
    input: UpdateReportStatusInput,
  ): Promise<AbuseReportDto> {
    const row = await this.pool.query<ReportRow>(
      `UPDATE identity.abuse_reports
       SET status = $2,
           reviewed_by = $3,
           reviewed_at = now(),
           review_note = $4
       WHERE id = $1
       RETURNING id, reporter_id, target_type, target_id, reason, details, status, created_at,
                 reviewed_by, reviewed_at, review_note`,
      [reportId, input.status, reviewerId, input.note ?? ''],
    );
    if ((row.rowCount ?? 0) === 0) {
      throw new NotFoundException('Report not found');
    }
    return mapRow(row.rows[0]!);
  }
}

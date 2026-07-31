import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from '@social/platform-telemetry';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let health: HealthService;

  beforeEach(async () => {
    health = new HealthService({
      probes: [{ name: 'self', check: () => true }],
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();

    controller = module.get(HealthController);
  });

  it('live returns ok', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('ready returns dependency checks', async () => {
    const status = jest.fn();
    const res = { status } as unknown as import('express').Response;

    await expect(controller.ready(res)).resolves.toEqual({
      status: 'ok',
      checks: { self: 'up' },
    });
    expect(status).not.toHaveBeenCalled();
  });

  it('ready sets 503 when unavailable', async () => {
    health = new HealthService({
      probes: [{ name: 'db', check: () => false }],
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    }).compile();
    controller = module.get(HealthController);

    const status = jest.fn();
    const res = { status } as unknown as import('express').Response;

    await expect(controller.ready(res)).resolves.toMatchObject({
      status: 'unavailable',
    });
    expect(status).toHaveBeenCalledWith(503);
  });
});

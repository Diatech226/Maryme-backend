import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = error instanceof HttpException ? error.getResponse() : 'Internal server error';
    const object = typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const message = typeof raw === 'string' ? raw : (object.message ?? 'Request failed');
    const code =
      typeof object.code === 'string'
        ? object.code
        : status === 400
          ? 'VALIDATION_ERROR'
          : HttpStatus[status];
    response.status(status).json({
      ...object,
      statusCode: status,
      code,
      message,
      details: object.message instanceof Array ? object.message : undefined,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

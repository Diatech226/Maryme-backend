import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
@Injectable()
export class ResponseInterceptor implements NestInterceptor { intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> { return next.handle().pipe(map((value: unknown) => value === undefined ? undefined : (typeof value === 'object' && value !== null && ('data' in value || 'accessToken' in value) ? value : { data: value}))); } }

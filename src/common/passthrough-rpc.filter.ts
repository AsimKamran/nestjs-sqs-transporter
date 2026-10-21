import { ArgumentsHost, Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';


@Catch()
export class PassThroughRpcFilter implements RpcExceptionFilter<any> {
  catch(exception: any, _host: ArgumentsHost): Observable<any> {
    return throwError(() => exception);
  }
}
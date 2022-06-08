import hash from "object-hash";
import { from, iif, merge, Observable, of, Subject, throwError } from "rxjs";

import {
  switchMap,
  tap,
  shareReplay,
  mergeMap,
  map,
  catchError,
  concatMap,
  exhaustMap,
  filter,
  delay,
  retryWhen,
} from "rxjs/operators";
import { ModuleUtils } from "../exports";
import { IRetryProcessing, IRxExecutorConfig } from "../model";

type ExecutionStatus =
  | "RETRYING"
  | "WAITING"
  | "PROCESSING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED";

interface IExecutionState<P, D> {
  id?: string;
  params: P;
  hashedParams?: string;
  status?: ExecutionStatus;
  data?: D;
  error: any;
}

const generateUniqSerial = () => {
  return "xxxx-xxxx-xxx-xxxx".replace(/[x]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export class Execution2<P, D> implements IExecutionState<P, D> {
  id: string;
  status?: ExecutionStatus;
  data?: D;
  error: any;
  hashedParams?: string;
  private _state$ = new Subject<Execution2<P, D>>();

  get state$() {
    const state$ = this._state$
      .asObservable()
      .pipe(shareReplay()) as Observable<Execution2<P, D>>;
    return state$;
  }

  constructor(
    public params: P,
    public config: {
      executeFn$?: IRxExecuteFn2<P, D>;
      cache?: boolean;
      getId?: (params: P) => string;
    }
  ) {
    const conf = config || {
      cache: false,
      getId: (params) => generateUniqSerial(),
    };
    this.hashedParams = conf.cache ? hash(params) : undefined;
    this.id = conf.getId ? conf.getId(params) : generateUniqSerial();
  }

  get state(): IExecutionState<P, D> {
    return this;
  }

  retrying() {
    this.status = "RETRYING";
    this._state$.next(this);

    this.status = "PROCESSING";
    this._state$.next(this);

    return this.state;
  }

  wait() {
    this.status = "WAITING";
    this._state$.next(this);
    return this.state;
  }

  processing() {
    this.status = "PROCESSING";
    this._state$.next(this);
    return this.state;
  }

  succeed(data: D) {
    this.data = data;
    this.status = "SUCCESS";
    this._state$.next(this);
    return this.state;
  }

  failed(error: any) {
    this.error = error;
    this.status = "FAILED";
    this._state$.next(this);
    return this.state;
  }

  cancelled() {
    this.status = "CANCELLED";
    this._state$.next(this);
    return this.state;
  }

  listen(callback: (execution: Execution2<P, D>) => void) {
    this.state$.subscribe(callback);
  }
}

type ProcessingType = "CONCAT" | "EXHAUST" | "MERGE" | "SWITCH";
export const getTypeOperation2 = (processingType: ProcessingType) => {
  switch (processingType) {
    case "CONCAT":
      return concatMap;
    case "EXHAUST":
      return exhaustMap;
    case "MERGE":
      return mergeMap;
    case "SWITCH":
      return switchMap;
    default:
      return switchMap;
  }
};

type OnWaitType<P> = (params: P, context?: { [key: string]: any }) => void;
type OnProcessingType<P> = (
  params: P,
  context?: { [key: string]: any }
) => void;
type OnCancelType<P> = (params: P, context?: { [key: string]: any }) => void;
type OnSuccessType<P, D> = (
  data: D,
  params: P,
  context?: { [key: string]: any }
) => void;
type OnErrorType<P> = (
  error: any,
  params: P,
  context?: { [key: string]: any }
) => void;

export interface IExecutor<P, D> {
  enabledRetry?: boolean;
  sequential?: "SWITCH" | "EXHAUST" | "MERGE";
  concurrent?: {
    type?: "SWITCH" | "EXHAUST" | "MERGE" | "CONCAT";
    detailed?: boolean;
    mergeCapacity: number;
  };
  params$?: Observable<P>;

  wrapData$?: (data$: Observable<D>) => Observable<D>;

  cache?: boolean;
  cacheLifetimeime?: number;
  context?: { [key: string]: any };
  onRetry?: (error: any, params: P) => void;
  onWait?: OnWaitType<P>;
  onProcessing?: OnProcessingType<P>;
  onCancel?: OnCancelType<P>;
  onSuccess?: OnSuccessType<P, D>;
  onError?: OnErrorType<P>;
  getId?: (params: P) => string;

  retry?: IRetryProcessing;
}

export type IRxExecuteFn2<P, D> = (params: P) => D | Promise<D> | Observable<D>;

export class RxExecutor2<P, D> {
  private _status?: ExecutionStatus;
  private _data?: D;
  private _params?: P;

  private _error: any;

  get params() {
    return this._params;
  }

  get error() {
    return this._error;
  }

  get status() {
    return this._status;
  }

  get data() {
    return this._data;
  }

  get isLoading() {
    return this._status === "PROCESSING";
  }

  get isProcessing() {
    return this._status === "PROCESSING";
  }

  get isSuccess() {
    return this._status === "SUCCESS";
  }

  get isError() {
    return this._status === "FAILED";
  }

  retry() {
    return this.execute(this._params!);
  }

  private _internalExecution$ = new Subject<Execution2<P, D>>();

  private executionType: "SEQUENTIAL" | "CONCURRENT";
  private operationType: "SWITCH" | "EXHAUST" | "MERGE" | "CONCAT";
  private processorCapacity: number = 1;
  private enableCache: boolean = false;
  // TODO:
  private concurrentDetailed: boolean = false;

  constructor(
    private executeFn$: IRxExecuteFn2<P, D>,
    private config?: IExecutor<P, D>
  ) {
    this.executionType = config
      ? config.concurrent
        ? "CONCURRENT"
        : "SEQUENTIAL"
      : "SEQUENTIAL";

    const tempConfig = this.config || {
      sequential: "SWITCH",
      concurrent: { type: "SWITCH", mergeCapacity: 1, detailed: true },
      cache: false,
    };
    this.concurrentDetailed = !!tempConfig.concurrent?.detailed;
    const { concurrent, sequential } = tempConfig;
    this.operationType =
      sequential || (concurrent && concurrent.type) || "SWITCH";

    if (
      this.operationType === "MERGE" &&
      tempConfig.concurrent!.mergeCapacity > 1
    ) {
      this.processorCapacity = tempConfig.concurrent!.mergeCapacity;
    }

    this.enableCache = !!tempConfig.cache;
    this.execute = this.execute.bind(this);
    this.close = this.close.bind(this);
    this.getExecution = this.getExecution.bind(this);
    this._state$ = this.getState$();
    this.config = config || {};
  }

  get state$() {
    return this._state$;
  }

  _state$: Observable<IExecutionState<P, D>>;

  close() {}

  private cachedData: { [key: string]: D } = {};

  private cachedExecution: { [key: string]: Execution2<P, D> } = {};

  static create<P, D>(
    executeFn$: IRxExecuteFn2<P, D>,
    config?: IExecutor<P, D>
  ) {
    return new RxExecutor2<P, D>(executeFn$, config);
  }

  _execution?: Execution2<P, D>;

  getExecution(id?: string) {
    return this._execution;
  }

  execute(
    params: P,
    config?: {
      executeFn$: IRxExecuteFn2<P, D>;
      getId?: (params: P) => string;
      context?: { [key: string]: any };
      onWait?: OnWaitType<P>;
      onRetry: (error: any, params: P) => void;
      onProcessing?: OnProcessingType<P>;
      onCancel?: OnCancelType<P>;
      onSuccess?: OnSuccessType<P, D>;
      onError?: OnErrorType<P>;
    }
  ) {
    const execution = this._execute(params, config);
    this._execution = execution;
    this._internalExecution$.next(execution);

    return execution;
  }

  private _execute(
    params: P,
    config?: {
      executeFn$: IRxExecuteFn2<P, D>;
      getId?: (params: P) => string;
      context?: { [key: string]: any };
      onWait?: OnWaitType<P>;
      onRetry: (error: any, params: P) => void;
      onProcessing?: OnProcessingType<P>;
      onCancel?: OnCancelType<P>;
      onSuccess?: OnSuccessType<P, D>;
      onError?: OnErrorType<P>;
    }
  ) {
    const context = (config ? config.context : {}) || {};
    const mergedContext = {
      ...((this.config && this.config.context) || {}),
      ...context,
    };

    if (
      this.executionType === "SEQUENTIAL" &&
      this.operationType === "EXHAUST"
    ) {
      const currentxecution = this.processingExecutions[0];
      if (currentxecution) {
        return currentxecution;
      }
    }
    const execution = new Execution2<P, D>(params, {
      executeFn$: config?.executeFn$,
      cache: this.config?.cache,
      getId: this.config?.getId,
    });
    if (this.enableCache) {
      const key = hash(params);
      this.cachedExecution[key] = execution;
    }

    execution.state$.subscribe((exec) => {
      if (this.executionType === "SEQUENTIAL") {
        if (
          this.operationType === "EXHAUST" ||
          this.operationType === "SWITCH"
        ) {
          this._params = exec.params;
          this._status = exec.status;
          if (exec.status === "SUCCESS") this._data = exec.data;
          if (exec.status === "FAILED") this._error = exec.error;
        }
      }
      if (exec.status === "RETRYING") {
        config && config.onRetry && config.onRetry(exec.error, exec.params);

        this.config &&
          this.config.onRetry &&
          this.config.onRetry(exec.error, exec.params);
      }

      if (exec.status === "PROCESSING") {
        config &&
          config.onProcessing &&
          config.onProcessing(exec.params, mergedContext);

        this.config &&
          this.config.onProcessing &&
          this.config.onProcessing(exec.params, mergedContext);
      }
      if (exec.status === "SUCCESS") {
        config &&
          config.onSuccess &&
          config.onSuccess(exec.data!, exec.params, mergedContext);

        this.config &&
          this.config.onSuccess &&
          this.config.onSuccess(exec.data!, exec.params, mergedContext);
      }
      if (exec.status === "FAILED") {
        config &&
          config.onError &&
          config.onError(exec.error, exec.params, mergedContext);

        this.config &&
          this.config.onError &&
          this.config.onError(exec.error, exec.params, mergedContext);
      }
      if (exec.status === "WAITING") {
        config && config.onWait && config.onWait(exec.params, mergedContext);

        this.config &&
          this.config.onWait &&
          this.config.onWait(exec.params, mergedContext);
      }
      if (exec.status === "CANCELLED") {
        config &&
          config.onCancel &&
          config.onCancel(exec.params, mergedContext);

        this.config &&
          this.config.onCancel &&
          this.config.onCancel(exec.params, mergedContext);
      }
    });
    return execution;
  }

  private processingExecutions: Execution2<P, D>[] = [];
  private failedExecutions: Execution2<P, D>[] = [];

  invalidCache(params: any) {
    const key = hash(params);
    const found = !!this.cachedData[key];
    delete this.cachedData[key];
    return found;
  }

  clearCache() {
    this.cachedData = {};
  }

  isFull(): boolean {
    return this.processingExecutions.length >= this.processorCapacity;
  }

  getState$() {
    const mergedExecutions$ =
      this.config && this.config.params$
        ? merge(
            this._internalExecution$,
            this.config.params$.pipe(map((params) => this._execute(params)))
          )
        : this._internalExecution$;

    const asyncOperation = getTypeOperation2(this.operationType);
    const waitingSubject = new Subject<Execution2<P, D>>();
    const retrySubject = new Subject<Execution2<P, D>>();

    const retryConfig: IRetryProcessing =
      this.config && this.config.retry
        ? this.config.retry
        : {
            interval: 1000,
            maxRetryAttempts: 0,
          };
    const maxRetryAttempts = retryConfig.maxRetryAttempts
      ? retryConfig.maxRetryAttempts
      : 0;
    const notRetryWhenStatus = retryConfig.notRetryWhenStatus
      ? retryConfig.notRetryWhenStatus
      : [];

    return merge(
      retrySubject.pipe(
        map((execution) => {
          execution.retrying();
          return execution.state;
        })
      ),
      waitingSubject.pipe(
        filter(() => {
          return (
            this.operationType === "SWITCH" &&
            this.executionType === "CONCURRENT"
          );
        }),
        map((execution) => {
          execution.wait();
          return execution.state;
        })
      ),
      mergedExecutions$.pipe(
        tap((execution) => {
          waitingSubject.next(execution);
        }),
        asyncOperation((execution) => {
          const { params } = execution;

          let cachedData: D | undefined = undefined;
          if (this.enableCache) {
            const key = hash(params);
            cachedData = this.cachedData[key];
          }
          const executeFn$ = execution.config?.executeFn$ || this.executeFn$;
          const data$ = executeFn$
            ? executeFn$(params)
            : of(params).pipe(map((p: any) => p as D));

          const loadData$: Observable<D> =
            this.enableCache && cachedData !== undefined
              ? of(cachedData).pipe(delay(1))
              : ModuleUtils.isObservable(data$)
              ? data$
              : ModuleUtils.isPromise(data$)
              ? from(data$)
              : of(data$);

          const wrapData$ = this.config?.wrapData$
            ? this.config.wrapData$(loadData$)
            : loadData$;

          return merge(
            of(execution).pipe(
              filter(() => {
                return (
                  this.operationType === "SWITCH" &&
                  this.executionType === "CONCURRENT" &&
                  this.isFull()
                );
              }),
              map(() => {
                const execution = this.processingExecutions[0];
                execution.cancelled();
                return execution.state;
              })
            ),
            of(execution).pipe(
              filter(() => {
                return (
                  this.operationType !== "SWITCH" ||
                  this.executionType !== "SEQUENTIAL" ||
                  !this.isFull()
                );
              }),
              tap((execution) => {
                this.processingExecutions.push(execution);
              }),
              map((execution) => {
                execution.processing();
                return execution.state;
              })
            ),
            wrapData$.pipe(
              /*********************************************************/

              retryWhen((errors) =>
                errors.pipe(
                  tap((e) => {
                    // execution.addError(e);
                  }),
                  concatMap((e: any, i) =>
                    iif(
                      () => {
                        if (i < maxRetryAttempts) {
                          const responseStatus = (e || {}).status || 0;
                          const notRetry = !!notRetryWhenStatus.find(
                            (status) => status === responseStatus
                          );
                          if (notRetry) {
                            return true;
                          }
                          if (
                            retryConfig.noRetryWhen &&
                            retryConfig.noRetryWhen(e)
                          ) {
                            return true;
                          }
                          return false;
                        }
                        return true;
                      },
                      throwError(() => e),
                      of(e).pipe(
                        tap(() => {
                          retrySubject.next(execution);
                        }),
                        delay(
                          (retryConfig.typeInterval === "LINEAR" ? 1 : i) *
                            retryConfig.interval
                        )
                      )
                    )
                  )
                )
              ),
              /*********************************************************/
              map((resp) => {
                execution.succeed(resp);
                return execution.state;
              }),
              tap(
                (execution) => {
                  this.processingExecutions = this.processingExecutions.filter(
                    (e) => e !== execution
                  );
                  if (this.enableCache) {
                    this.cachedData[execution.hashedParams!] = execution.data!;
                  }
                },
                () => {
                  this.processingExecutions = this.processingExecutions.filter(
                    (e) => e !== execution
                  );
                }
              ),
              catchError((error) => {
                execution.failed(error);
                return of(execution.state);
              })
            )
          );
        })
      )
    ).pipe(shareReplay());
  }
}

import { from, iif, merge, Observable, of, Subject, throwError } from "rxjs";
import {
  catchError,
  concatMap,
  delay,
  exhaustMap,
  map,
  mergeMap,
  retryWhen,
  switchMap,
  takeUntil,
  tap,
} from "rxjs/operators";
import {
  IRxExecutorConfig,
  IRxExecuteFn,
  IExecution,
  IExecutionState,
  IRetryProcessing,
  ProcessingType,
} from ".";
import { ModuleUtils } from "./utils/lang";

const generateUUID = () => {
  var d = new Date().getTime();
  var d2 =
    (typeof performance !== "undefined" &&
      performance.now &&
      performance.now() * 1000) ||
    0;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.random() * 16;
    if (d > 0) {
      r = (d + r) % 16 | 0;
      d = Math.floor(d / 16);
    } else {
      r = (d2 + r) % 16 | 0;
      d2 = Math.floor(d2 / 16);
    }
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const getTypeOperation = (processingType: ProcessingType) => {
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

export class Execution<P, D> implements IExecution<P, D> {
  state: IExecutionState<D> = {};
  onQueueTime!: Date;
  params!: P;
  onProcessingTime?: Date;
  onCompleteTime?: Date;
  onCanceledTime?: Date;
  _errors: any[] = [];
  index: number = -1;
  constructor(public key: string) {}

  setWaiting(params: P, index: number) {
    this.params = params;
    this.state = {
      status: "WAITING",
    };
    this.onQueueTime = new Date();
    return this;
  }

  setCanceled(key: string) {
    this.key = key;
    this.state = {
      status: "CANCELED",
    };
    this.onCanceledTime = new Date();
    return this;
  }
  setProcessing() {
    this.onProcessingTime = new Date();
    this.state = { ...this.state, status: "PROCESSING" };
    return this;
  }
  setSuccess(data: D) {
    this.onCompleteTime = new Date();
    this.state = { ...this.state, data, status: "SUCCESS" };
    return this;
  }

  setError(error: any) {
    this.onCompleteTime = new Date();
    this.state = { ...this.state, error, status: "ERROR" };
    return this;
  }

  setData(data: D) {
    this.state = { ...this.state, data };
  }

  get isLoading() {
    return this.state.status === "PROCESSING";
  }

  get isError() {
    return this.state.status === "ERROR";
  }

  get isSuccess() {
    return this.state.status === "SUCCESS";
  }

  get isWaiting() {
    return this.state.status === "WAITING";
  }

  get isCanceled() {
    return this.state.status === "CANCELED";
  }

  get data() {
    return this.state.data;
  }

  get error() {
    return this.state.error;
  }

  get errors() {
    return this._errors;
  }

  get status() {
    return this.state.status;
  }

  addError(error: any) {
    this.errors.unshift(error);
  }
}

export class RxConcurrentExecutor<P = void, D = any> {
  execute(params: P) {
    const config = this.config ? this.config : {};
    const getKey = config.getKey;
    const key = getKey ? getKey(params) : generateUUID();
    const execution = new Execution<P, D>(key);
    //TODO: asyncLock
    this.executions[key] = execution;
    this.execute$.next({ key, params: params });
    return execution;
  }

  isLoading(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.isLoading;
  }

  isError(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }

    return execution.isError;
  }

  isSuccess(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.isSuccess;
  }

  data(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.state.data;
  }

  error(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }

    return execution.state.error;
  }

  errors(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.errors;
  }

  status(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.state.status;
  }

  retry(key: string) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return this.execute(execution.params);
  }

  setData(key: string, data: D) {
    const execution = this._executions[key];
    if (!execution) {
      return;
    }
    return execution.setData(data);
  }

  getExecution(key: string) {
    return this._executions[key];
  }

  private execute$ = new Subject<{ key: string; params: P }>();
  private internalDestroy$ = new Subject<void>();
  readonly execution$: Observable<IExecution<P, D>>;

  _executions: { [key: string]: Execution<P, D> } = {};

  get executions() {
    return this._executions;
  }

  static create<P, D>(
    executeFn$: IRxExecuteFn<P, D>,
    config?: IRxExecutorConfig<P, D>
  ) {
    return new RxConcurrentExecutor<P, D>(executeFn$, config);
  }

  constructor(
    protected executeFn$: IRxExecuteFn<P, D>,
    protected config?: IRxExecutorConfig<P, D>
  ) {
    this.isLoading = this.isLoading.bind(this);
    this.execute = this.execute.bind(this);
    this.retry = this.retry.bind(this);
    this.isError = this.isError.bind(this);
    this.isSuccess = this.isSuccess.bind(this);
    this.data = this.data.bind(this);
    this.error = this.error.bind(this);
    this.errors = this.errors.bind(this);
    this.status = this.status.bind(this);
    this.setData = this.setData.bind(this);
    this.getExecution = this.getExecution.bind(this);

    this.config = config ? config : {};
    const effectiveDestroy$ = this.config.destroy$
      ? merge(this.config.destroy$, this.internalDestroy$)
      : this.internalDestroy$;
    const internalConfig: IRxExecutorConfig<P, D> = this.config
      ? this.config
      : {};
    const execute$ = internalConfig.source$
      ? merge(
          internalConfig.source$.pipe(
            map((params): { key: string; params: P } => {
              const getKey = this.config!.getKey;
              const key = getKey ? getKey(params) : generateUUID();
              return { key, params };
            }),
            tap(({ key, params }) => {
              let execution = this._executions[key];
              //TODO: asyncLock
              execution = new Execution<P, D>(key);
              this._executions[key] = execution;
            })
          ),
          this.execute$
        )
      : this.execute$;

    const asyncOperation = getTypeOperation(internalConfig.processingType!);
    this.execution$ = execute$
      .pipe(
        takeUntil(effectiveDestroy$),
        map((execute, index) => {
          let execution = this._executions[execute.key];
          execution.setWaiting(execute.params, index);
          if (
            !!Object.keys(this.executions)
              .map((key) => this.executions[key])
              .find((execution) => execution.state.status === "PROCESSING") &&
            this.config!.processingType === "EXHAUST"
          ) {
            execution.setCanceled(execute.key);
          }
          if (this.config!.processingType === "SWITCH") {
            Object.keys(this.executions)
              .map((key) => this.executions[key])
              .filter((execution) => execution.state.status === "PROCESSING")
              .forEach((execution) => {
                execution.setCanceled(execute.key);
              });
          }
          config!.onExecutionChange && config!.onExecutionChange(execution);
          return execution;
        }),
        tap((execution) => {
          config!.onQueuing &&
            config!.onQueuing(execution.params, execution.key, execution);
          config!.onExecutionChange && config!.onExecutionChange(execution);
        }),
        asyncOperation((execution) => {
          const params = execution.params;
          const data$ = this.executeFn$
            ? this.executeFn$(params)
            : of(params).pipe(map((p: any) => p as D));
          const loadData$: Observable<D> = ModuleUtils.isObservable(data$)
            ? data$
            : ModuleUtils.isPromise(data$)
            ? from(data$)
            : of(data$);
          execution.setProcessing();
          this._executions[execution.key] = execution;

          const retryConfig: IRetryProcessing = internalConfig.retry
            ? internalConfig.retry
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
            of(execution),
            loadData$
              .pipe(
                retryWhen((errors) =>
                  errors.pipe(
                    tap((e) => {
                      execution.addError(e);
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
                          delay(
                            (retryConfig.typeInterval === "LINEAR" ? 1 : i) *
                              retryConfig.interval
                          )
                        )
                      )
                    )
                  )
                ),
                map((data) => execution.setSuccess(data))
              )
              .pipe(catchError((error) => of(execution.setError(error))))
          );
        })
      )
      .pipe(
        tap((execution: Execution<P, D>) => {
          config!.onExecutionChange && config!.onExecutionChange(execution);
          execution.state.status === "WAITING" &&
            config!.onQueuing &&
            config!.onQueuing(execution.params, execution.key, execution);
          execution.state.status === "PROCESSING" &&
            config!.onProcessing &&
            config!.onProcessing(execution.params, execution.key, execution);
          execution.state.status === "SUCCESS" &&
            config!.onSuccess &&
            config!.onSuccess(
              execution.state.data!,
              execution.params,
              execution.key,
              execution
            );
          execution.state.status === "ERROR" &&
            config!.onError &&
            config!.onError(
              execution.state.error,
              execution.params,
              execution.key,
              execution
            );
        })
      );
  }

  init() {
    this.execution$.subscribe();
  }

  destroy() {
    this.internalDestroy$.next();
    this.internalDestroy$.complete();
  }
}

import { Observable, Subject } from "rxjs";

export type SetDataTypeCallbackType<T> = (prevData: T) => T;
export type SetDataType<T> = (callBack: SetDataTypeCallbackType<T>) => void;

export type IRxExecuteFn<P, D> = (params: P) => D | Promise<D> | Observable<D>;

export interface IExecution<P, D> {
  key: string;
  params: P;
  state: IExecutionState<D>;
  onQueueTime: Date;
  onProcessingTime?: Date;
  onCompleteTime?: Date;
  errors: any[];
  index: number;
}

export interface IRxExecutorConfig<P, D> {
  getKey?: (params: P) => string;
  processingType?: ProcessingType;
  retry?: IRetryProcessing;
  source$?: Observable<P>;
  onQueuing?: (params: P, id: string, execution: IExecution<P, D>) => void;
  onProcessing?: (params: P, id: string, execution: IExecution<P, D>) => void;
  onCancel?: (params: P, id: string, execution: IExecution<P, D>) => void;
  onSuccess?: (
    data: D,
    params: P,
    id: string,
    execution: IExecution<P, D>
  ) => void;
  onError?: (
    error: any,
    params: P,
    id: string,
    execution: IExecution<P, D>
  ) => void;
  onExecutionChange?: (execution: IExecution<P, D>) => void;
  destroy$?: Subject<void>;
}
export type AsyncExecutionSetStateType<P, D> = (
  a: (prevExecution: IExecution<P, D>) => IExecution<P, D>
) => void;

export type EnumStatusType =
  | "WAITING"
  | "PROCESSING"
  | "SUCCESS"
  | "ERROR"
  | "CANCELED";
export interface IExecutionState<T = any> {
  status?: EnumStatusType;
  data?: T;
  error?: any;
  config?: any;
}

export interface IRetryProcessing {
  maxRetryAttempts: number;
  interval: number;
  typeInterval?: "LINEAR" | "EXPONENTIAL";
  notRetryWhenStatus?: number[];
  noRetryWhen?: (error: any) => boolean;
}

export type ProcessingType = "EXHAUST" | "CONCAT" | "MERGE" | "SWITCH";

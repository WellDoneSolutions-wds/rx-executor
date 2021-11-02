import { IRxExecutorConfig, IRxExecuteFn } from ".";
import { Execution, RxConcurrentExecutor } from "./RxConcurrentExecutor";

export class RxExecutor<P = void, D = any> {
  key = "---key---";
  concurrentExecutor: RxConcurrentExecutor<P, D>;

  constructor(
    protected executeFn$: IRxExecuteFn<P, D>,
    protected config?: IRxExecutorConfig<P, D>
  ) {
    this.concurrentExecutor = RxConcurrentExecutor.create(executeFn$, {
      ...config,
      getKey: () => this.key,
    });
    this.execute = this.execute.bind(this);
  }

  static create<P, D>(
    executeFn$: IRxExecuteFn<P, D>,
    config?: IRxExecutorConfig<P, D>
  ) {
    return new RxExecutor<P, D>(executeFn$, config);
  }

  get execution(): Execution<P, D> {
    return (
      this.concurrentExecutor.executions[this.key] ||
      new Execution<P, D>(this.key)
    );
  }

  get isLoading(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get isProcessing(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get isError(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get isSuccess(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get data(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get errors(): boolean {
    return this.execution.state.status === "PROCESSING";
  }

  get executions() {
    return this.concurrentExecutor.executions;
  }

  execute(params: P) {
    this.concurrentExecutor.execute(params);
  }

  retry() {
    this.concurrentExecutor.retry(this.key);
  }
}

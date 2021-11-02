import { from, Observable, of, zip } from "rxjs";

import { concatMap, delay, delayWhen, map, take } from "rxjs/operators";

import { ModuleUtils } from "../utils/lang";
import { MockServerConfig } from "./model";

export class MockServer {
  constructor(private config: MockServerConfig) {}
  static create = (config: MockServerConfig) => {
    return new MockServer(config);
  };
  getConfig() {
    const responses = this.config.responses.map((response) => {
      const ocurrence = response.ocurrence ? response.ocurrence : Math.random();
      const delay = response.delay ? response.delay : 0;
      const isError = !!response.isError;
      return { ...response, ocurrence, delay, isError };
    });
    const sum = responses.reduce((t, e) => t + e.ocurrence, 0);
    const ranges = responses
      .map((response) => {
        return {
          ...response,
          percentil: Math.floor((response.ocurrence * 100) / sum),
        };
      })
      .reduce((t: any[], e) => {
        const lastRange =
          t.length > 0 ? t[t.length - 1] : { top: 0, bottom: 0 };
        return [
          ...t,
          {
            ...e,
            top: lastRange.top + e.percentil,
            bottom: lastRange.top,
          },
        ];
      }, []);

    const randomValue = Math.floor(Math.random() * 100);
    return ranges.find(
      (range) => randomValue > range.bottom && randomValue <= range.top
    );
  }

  invoke() {
    return of("").pipe(
      concatMap((_) => of(this.getConfig())),
      take(1),
      delayWhen((config) => {
        return of(config.delay);
      }),
      concatMap((config: any) => {
        const data$ = config.data();
        const loadData$: Observable<any> = ModuleUtils.isObservable(data$)
          ? data$
          : ModuleUtils.isPromise(data$)
          ? from(data$)
          : of(data$);
        return zip(loadData$, of(config.isError));
      }),
      map((data: any) => {
        if (data[1]) throw data[0];
        return data[0];
      })
    );
  }
}

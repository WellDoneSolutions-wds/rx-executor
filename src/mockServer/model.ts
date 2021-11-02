export interface MockServerConfigResponse {
  delay?: number;
  isError?: boolean;
  ocurrence?: number;
  data: () => any;
}

export interface MockServerConfig {
  responses: MockServerConfigResponse[];
}

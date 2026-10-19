//+_+// Domain and transaction errors for IndexedDB concurrency and fence controls

export class StaleSessionError extends Error {
  constructor(message = "오래된 세션입니다. 최신 데이터를 반영하기 위해 새로고침해 주세요.") {
    super(message);
    this.name = "StaleSessionError";
  }
}

export class WriteFenceActiveError extends Error {
  constructor(message = "데이터 백업 또는 복원 작업 중에는 쓰기 작업이 차단됩니다.") {
    super(message);
    this.name = "WriteFenceActiveError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

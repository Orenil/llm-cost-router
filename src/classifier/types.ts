export interface TrainingExample {
  features: number[];
  /** 1 = cheap model got this query wrong (needs the big model), 0 = cheap was fine. */
  label: number;
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

export interface Sample {
  name: string;
  file: string;
  why: string;
}
export declare const SAMPLES: Array<{ name: string; w: number; h: number; why: string; huge?: boolean }>;
export declare function makeSamples(dir: string, opts?: { huge?: boolean; only?: string[] }): Promise<Sample[]>;

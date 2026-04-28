export type Evaluate<T> = T extends object ? (T extends infer O ? { [K in keyof O]: Evaluate<O[K]> } : never) : T

export type UnpackArray<T> = T extends (infer U)[] ? U : T

export type ExtractWithKey<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T : never) : never

export type ExtractAndEnsureDefined<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T & { [P in K]-?: Exclude<T[P], undefined> }
    : never
  : never

export type ToUppercaseKeys<T> = {
  [K in keyof T as Uppercase<K & string>]: T[K]
}

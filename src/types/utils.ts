export type ValueOf<T> = T[keyof T];

export type UnpackArray<T> = T extends readonly (infer U)[] ? U : T;

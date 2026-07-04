declare const brand: unique symbol;

type Brand<TValue, TName extends string> = TValue & {
  readonly [brand]: TName;
};

function brandValue<TValue, TName extends string>(value: TValue) {
  return value as Brand<TValue, TName>;
}

export { brandValue };
export type { Brand };

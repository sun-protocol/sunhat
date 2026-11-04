import { z } from 'zod';

export const frameworkSchema = z.enum(['foundry', 'hardhat']);
export const targetSchema = z.enum(['tron', 'evm']);

const tableSchema = z.unknown().refine(isTable);

export const bindingSchema = tableSchema
  .pipe(
    z.object({
      project: tableSchema.pipe(
        z.object({
          framework: frameworkSchema,
          target: targetSchema,
        }),
      ),
    }),
  )
  .transform(({ project }) => project);

export type Framework = z.infer<typeof frameworkSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Binding = Readonly<z.infer<typeof bindingSchema>>;

function isTable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

import { z } from 'zod';

// Date format regex: MM/DD/YYYY
const dateFormatRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;

// Validation schema
export const profileSchema = z.object({
  first_name: z.string().min(1, 'First name is required').max(50, 'First name is too long'),
  last_name: z.string().min(1, 'Last name is required').max(50, 'Last name is too long'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  date_of_birth: z.string()
    .refine((val) => !val || dateFormatRegex.test(val), {
      message: 'Please enter a valid date (MM/DD/YYYY)',
    })
    .optional(),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

// Re-export User from shared types for convenience
// Profile is the same as User - using shared type for consistency
import type { User } from "@/types/shared";

// Alias Profile to User for backward compatibility
export type Profile = User;


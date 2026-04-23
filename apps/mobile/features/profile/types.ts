import { z } from 'zod';

// Date format regex: MM/DD/YYYY
const dateFormatRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
// Birthday input for the Profile Information section: MM/DD only (no year).
const mmddRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/;

// Instagram handle: letters, numbers, periods, underscores — max 30 chars.
// Mirrors the server-side regex in functions/users.ts so client + server
// agree on what's a valid handle.
const instagramRegex = /^[A-Za-z0-9._]{1,30}$/;

// LinkedIn slug: letters, numbers, and hyphens, 3–100 chars. We strip the
// pasted `linkedin.com/in/` prefix before validating.
const linkedinRegex = /^[A-Za-z0-9-]{3,100}$/;

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
  zip_code: z.string().regex(/^\d{5}$/, "Must be a 5-digit ZIP code").or(z.literal("")).optional(),

  // Profile Information section
  bio: z
    .string()
    .max(500, 'Bio must be 500 characters or fewer')
    .optional()
    .or(z.literal('')),
  instagram_handle: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@+/, ''))
    .refine((v) => v === '' || instagramRegex.test(v), {
      message: 'Use letters, numbers, periods, or underscores (max 30)',
    })
    .optional()
    .or(z.literal('')),
  linkedin_handle: z
    .string()
    .trim()
    // Strip the URL prefix here too so the field accepts pasted profile links.
    .transform((v) => {
      const m = v.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
      return (m ? m[1] : v).replace(/^@+/, '').replace(/\/+$/, '');
    })
    .refine((v) => v === '' || linkedinRegex.test(v), {
      message: 'Use the slug from linkedin.com/in/<slug> (letters, numbers, hyphens)',
    })
    .optional()
    .or(z.literal('')),
  birthday_md: z
    .string()
    .refine((val) => !val || mmddRegex.test(val), {
      message: 'Please enter a valid date (MM/DD)',
    })
    .optional()
    .or(z.literal('')),
  location: z
    .string()
    .max(100, 'Location must be 100 characters or fewer')
    .optional()
    .or(z.literal('')),
});

export type ProfileFormData = z.infer<typeof profileSchema>;

// Re-export User from shared types for convenience
// Profile is the same as User - using shared type for consistency
import type { User } from "@/types/shared";

// Alias Profile to User for backward compatibility
export type Profile = User;


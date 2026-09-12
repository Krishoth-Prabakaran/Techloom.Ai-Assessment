# Task 01 Database Changes

All database changes are kept in `database/migrations/001_initial_schema.sql` in numbered sections.

## Migration 001: Initial schema

File: `migrations/001_initial_schema.sql`, section `001`

Creates `products` and `orders`, adds status and stock constraints, and seeds the three demo POS products.

## Change 002: Enable Row Level Security

File: `migrations/001_initial_schema.sql`, section `002`

Enables RLS on `products` and `orders`. No public policies are added because the client talks to the Express backend, not directly to Supabase.

## Change 003: Add product images

File: `migrations/001_initial_schema.sql`, section `003`

Adds nullable `products.image_url`. Existing rows are preserved, and image URLs can be updated directly in Supabase.

## Required workflow

For every database change:

1. Append the next numbered SQL section to `migrations/001_initial_schema.sql`.
2. Describe the same numbered change in this README.
3. Update the application code in the same change if the schema contract changes.
4. Test the migration against the shared Supabase project before deployment.


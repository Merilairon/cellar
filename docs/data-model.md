# Data Model: Recipe Book

## Entities

### User
-   `id` (UUID, PK)
-   `email` (string, unique, indexed)
-   `passwordHash` (string)
-   `createdAt`, `updatedAt` (timestamp)

### Recipe
-   `id` (UUID, PK)
-   `ownerId` (FK → User, indexed)
-   `title` (string, required)
-   `prepNote` (string, optional) — rendered as the table sub-header (e.g., "Preheat oven to 350°F (170°C)")
-   `servings` (integer, optional)
-   `prepTimeMin` (integer, optional)
-   `cookTimeMin` (integer, optional)
-   `image` (string URL, optional)
-   `sourceUrl` (string, optional) — attribution for imported recipes
-   `sourceSite` (string, optional)
-   `sourceAuthor` (string, optional)
-   `isPublic` (boolean, default true)
-   `createdAt`, `updatedAt` (timestamp)
-   `deletedAt` (timestamp, optional) — soft delete

### Ingredient
-   `id` (UUID, PK)
-   `recipeId` (FK → Recipe)
-   `name` (string, required)
-   `quantity` (decimal, optional)
-   `unit` (string, optional) — e.g., "oz", "cup", "tsp", "g"
-   `sortOrder` (integer) — display order
-   `stepId` (FK → Step, optional) — which step this ingredient belongs to

### Step
-   `id` (UUID, PK)
-   `recipeId` (FK → Recipe)
-   `action` (string, required) — e.g., "melt", "mix", "fold in", "bake"
-   `detail` (string, optional) — additional text, e.g., "for 30 to 40 min"
-   `temperature` (string, optional) — e.g., "350°F (170°C)"
-   `sortOrder` (integer) — display order; last step renders in the final column
-   `parentStepId` (FK → Step, optional) — supports hierarchical steps (sub-steps) for nested action columns

### Tag
-   `id` (UUID, PK)
-   `name` (string, unique, normalized lowercase)

### RecipeTag
-   `recipeId` (FK → Recipe)
-   `tagId` (FK → Tag)
-   composite PK

### ImportAttempt (audit log)
-   `id` (UUID, PK)
-   `url` (string)
-   `userId` (FK → User)
-   `status` (enum: `succeeded`, `failed`, `duplicate`)
-   `errorMessage` (string, optional)
-   `createdAt` (timestamp)

## Relationships

```
User 1─* Recipe
User 1─* ImportAttempt
Recipe 1─* Ingredient
Recipe 1─* Step
Step 1─* Ingredient
Step 1─* Step (parentStepId, hierarchy)
Recipe *─* Tag (via RecipeTag)
```

## Rendering Rules (strict table)

1.  **Title row:** recipe title spans all columns.
2.  **Prep note row:** `prepNote` spans all columns (omitted if empty).
3.  **Ingredient rows:** one row per ingredient in `sortOrder`; columns: quantity + name, then one column per step level.
4.  **Action columns:** for each step level (root → leaves), consecutive ingredients assigned to the same step share a merged cell labeled with the step's `action`.
5.  **Final column:** the last root step (highest `sortOrder`) renders as the final column, merged across all rows, showing `action` + `detail` + `temperature` (e.g., "bake 350°F (170°C) 30 to 40 min").
6.  **No steps:** table renders with ingredient columns only; action columns are empty.

## Normalization Notes

-   Quantities stored as decimal + unit string; never parsed at render time.
-   Tags stored lowercase; search is case-insensitive.
-   `sourceUrl` stored as-is (trailing slash normalized); duplicate detection compares normalized URL.
-   Soft delete: public queries filter `deletedAt IS NULL`; a deleted recipe's share URL returns 404.

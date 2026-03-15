# Find Pattern Command

Find examples of a code pattern in the codebase without reading entire files.

## Usage
```
/find-pattern [what you're looking for]
```

## Examples
```
/find-pattern dynamic UPDATE with paramIndex
/find-pattern healthie graphql mutation
/find-pattern transaction with BEGIN COMMIT
/find-pattern cron route authentication
/find-pattern telegram notification
```

## Steps

1. Use Grep to find matching code across `app/api/` and `lib/`
2. Show the matching file paths and surrounding context (3-5 lines)
3. Recommend which file is the best example to follow
4. Do NOT read the entire files — just show the grep results

## Why This Exists

Reading whole files eats your context window. This command lets you find exactly the pattern you need and see just the relevant code snippet, preserving context for the actual work.

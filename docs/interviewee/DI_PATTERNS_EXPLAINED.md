# Dependency Injection Patterns: When to Use `@Injectable()` vs Tokens

## Your Question

> Can we use `@Injectable()` for Db and IdempotencyStore, and then just inject them directly without `@Inject()` tokens?

**Short answer:** It depends! Simple classes can use `@Injectable()` directly, but conditional logic and external instances require tokens.

---

## ✅ Pattern 1: Simple Class with `@Injectable()` (No Token Needed)

### When You Control the Class

If you have a simple class you control, you can use `@Injectable()` and inject directly:

```typescript
// ✅ Simple service class
@Injectable()
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}
  
  async getUser(id: string) {
    return this.userRepository.findById(id);
  }
}

// ✅ Usage - just inject directly, no @Inject() needed
@Injectable()
export class UserController {
  constructor(private readonly userService: UserService) {}
  // NestJS automatically resolves UserService!
}
```

**In module:**
```typescript
@Module({
  providers: [
    UserService,  // ✅ Just list it - NestJS handles everything
    UserController,
  ],
})
```

---

## ❌ Pattern 2: Conditional Logic (Needs Token)

### The Problem: Dynamic Implementation Choice

For `IdempotencyStore`, we need to **choose** which implementation based on Redis availability:

```typescript
// ❌ This won't work - which class should NestJS create?
@Injectable()
export class IdempotencyStore { ... }  // Which one? Redis or InMemory?

// We need conditional logic:
if (redisAvailable) {
  return new RedisIdempotencyStore(redis);
} else {
  return new InMemoryIdempotencyStore();
}
```

### ✅ Solution: Token with `useFactory`

```typescript
// 1. Define a token (string or symbol)
export const IDEMPOTENCY_STORE = 'IDEMPOTENCY_STORE';

// 2. Use useFactory for conditional logic
@Module({
  providers: [
    {
      provide: IDEMPOTENCY_STORE,  // ✅ Token
      useFactory: (redis: any) => {
        if (redis) {
          return new RedisIdempotencyStore(redis);
        } else {
          return new InMemoryIdempotencyStore();
        }
      },
      inject: [REDIS],
    },
  ],
})

// 3. Inject using token
@Injectable()
export class DepositHandler {
  constructor(
    @Inject('IDEMPOTENCY_STORE') private readonly idempotency: IdempotencyStore
  ) {}
}
```

**Why we need the token:**
- We can't register a class directly because we're choosing between implementations
- `useFactory` requires a token to identify the provider

---

## ❌ Pattern 3: External Library Instance (Needs Token)

### The Problem: MongoDB `Db` is Not Your Class

```typescript
// ❌ Can't do this - Db is from 'mongodb' package
// We can't add @Injectable() to external library types

import { Db } from 'mongodb';
@Injectable()  // ❌ Doesn't work - not your class!
export class Db { ... }
```

### ✅ Solution Options

#### Option A: Wrapper Service (Recommended)

Create a wrapper service with `@Injectable()`:

```typescript
// ✅ Create a wrapper service
@Injectable()
export class DatabaseService {
  constructor(@Inject(DB) private readonly db: Db) {}
  
  getCollection(name: string) {
    return this.db.collection(name);
  }
}

// Now you can inject DatabaseService directly!
@Injectable()
export class MongoEventStore {
  constructor(private readonly database: DatabaseService) {
    // ✅ No @Inject() needed for DatabaseService!
  }
}
```

#### Option B: Keep Using Token (Current Approach)

```typescript
// Current approach - works fine
@Injectable()
export class MongoEventStore {
  constructor(@Inject(DB) private readonly db: Db) {
    // ✅ Token works for external instances
  }
}
```

---

## 🔄 Pattern 4: Interface-Based Injection (Needs Token)

### The Problem: TypeScript Interfaces Don't Exist at Runtime

```typescript
// ❌ This doesn't work - IdempotencyStore is an interface
export interface IdempotencyStore {
  get(key: string): Promise<any>;
}

// Can't do this:
constructor(private readonly store: IdempotencyStore) {}
// TypeScript erases interfaces at compile time!
```

### ✅ Solutions

#### Solution A: Abstract Class (Best for Type Safety)

```typescript
// ✅ Abstract class exists at runtime
export abstract class IdempotencyStore {
  abstract get(key: string): Promise<any>;
}

// Then inject by class
@Injectable()
export class DepositHandler {
  constructor(
    private readonly idempotency: IdempotencyStore  // ✅ Works!
  ) {}
}
```

#### Solution B: Token (Current Approach)

```typescript
// Current approach - use token
constructor(
  @Inject('IDEMPOTENCY_STORE') private readonly idempotency: IdempotencyStore
) {}
```

---

## 📊 Comparison Table

| Scenario | Can Use `@Injectable()`? | Needs Token? | Example |
|----------|-------------------------|--------------|---------|
| Simple service class | ✅ Yes | ❌ No | `UserService` |
| Conditional implementation | ❌ No | ✅ Yes | `IdempotencyStore` (Redis vs InMemory) |
| External library type | ❌ No | ✅ Yes (or wrapper) | MongoDB `Db` |
| Interface | ❌ No | ✅ Yes (or abstract class) | `IdempotencyStore` interface |
| Async initialization | ❌ No | ✅ Yes | Database connection |
| Multiple implementations | ❌ No | ✅ Yes | Different cache strategies |

---

## 🎯 Real-World Examples

### Example 1: Simple Service (No Token)

```typescript
// ✅ Simple case - just use @Injectable()
@Injectable()
export class EmailService {
  async send(email: string) { ... }
}

@Injectable()
export class UserService {
  constructor(private readonly emailService: EmailService) {}
  // ✅ No @Inject() needed!
}
```

### Example 2: Conditional Provider (Needs Token)

```typescript
// Current IdempotencyStore setup - needs token
{
  provide: 'IDEMPOTENCY_STORE',
  useFactory: (redis) => redis ? new RedisStore(redis) : new InMemoryStore(),
  inject: [REDIS],
}
```

### Example 3: External Instance (Needs Token or Wrapper)

```typescript
// Option A: Token (current)
constructor(@Inject(DB) private readonly db: Db) {}

// Option B: Wrapper service (alternative)
@Injectable()
export class DatabaseService {
  constructor(@Inject(DB) private readonly db: Db) {}
}

// Then inject wrapper directly
constructor(private readonly database: DatabaseService) {}
```

---

## 💡 Best Practices

### ✅ Use `@Injectable()` When:
1. You control the class
2. No conditional logic needed
3. Simple dependencies

### ✅ Use Tokens When:
1. Conditional/async initialization (`useFactory`)
2. External library instances
3. Interface-based injection
4. Multiple implementations

### 🎯 Hybrid Approach (Recommended)

```typescript
// For simple services - use @Injectable()
@Injectable()
export class UserService { ... }

// For conditional/external - use tokens
{
  provide: 'DATABASE',
  useFactory: async () => { ... },
}

// For interfaces - use abstract class if possible, otherwise token
export abstract class IdempotencyStore { ... }
```

---

## 🔄 Could We Refactor IdempotencyStore?

**Theoretical refactor** (not recommended for this use case):

```typescript
// ❌ This won't work because we need conditional logic
@Injectable()
export class IdempotencyStore {
  // But which implementation? Redis or InMemory?
  // We need to decide at runtime based on Redis availability
}
```

**Why it won't work:**
- We need to check if Redis is available
- We need to pass Redis client if available
- We need to fallback to InMemory if not
- This requires `useFactory` → requires token

**Alternative (if we always use one implementation):**

```typescript
// ✅ If we always used Redis (no fallback)
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(private readonly redis: Redis) {}
}

// Then we could inject directly:
constructor(private readonly idempotency: RedisIdempotencyStore) {}
```

But we lose the fallback capability!

---

## 📝 Summary

**Your question:** Can we avoid `@Inject()` tokens?

**Answer:** 
- ✅ **Yes**, for simple classes you control → use `@Injectable()` directly
- ❌ **No**, for conditional logic, external instances, or interfaces → need tokens

The current codebase uses tokens appropriately because:
1. `IdempotencyStore` needs conditional logic (Redis vs InMemory)
2. `Db` is an external MongoDB instance
3. Both require `useFactory` which needs tokens

**Trade-off:** Tokens add a bit of boilerplate (`@Inject()`), but give flexibility for conditional providers and external instances.


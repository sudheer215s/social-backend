# Twitter/LinkedIn Distributed Backend
## 8-Phase Implementation Plan

---

## Overview

| Phase | Name | Duration | Focus Area |
|-------|------|----------|------------|
| 1 | Foundation & User Service | 2 weeks | Project setup, Auth, User CRUD |
| 2 | Post & Graph Services | 2 weeks | Posts, Likes, Follows, gRPC |
| 3 | Event Streaming with Kafka | 2 weeks | Kafka, Outbox pattern, Event consumers |
| 4 | Timeline & Caching | 2 weeks | Redis, Fan-out, Timeline generation |
| 5 | Notifications & Real-time | 2 weeks | WebSocket, Pub/Sub, Alerts |
| 6 | Search & Discovery | 2 weeks | Elasticsearch, Full-text search |
| 7 | Reliability & Security | 2 weeks | Circuit breakers, Rate limiting, Hardening |
| 8 | Observability & Deployment | 2 weeks | Monitoring, Kubernetes, CI/CD |

**Total Duration: 16 weeks**

---

## Phase 1: Foundation & User Service

### Duration: 2 Weeks

### Goals
- Set up NestJS monorepo structure
- Implement complete User Service
- Establish authentication system
- Configure PostgreSQL with migrations
- Set up local development environment

### Week 1: Project Setup & Database

#### Day 1-2: Monorepo Structure
```
Tasks:
├── Initialize NestJS monorepo with nx or nest workspaces
├── Configure TypeScript strict mode
├── Set up ESLint + Prettier
├── Configure path aliases
├── Create shared libraries structure
└── Initialize Git with .gitignore
```

**Deliverables:**
- [ ] `nest new social-backend --package-manager=pnpm`
- [ ] Monorepo configuration (nest-cli.json)
- [ ] Shared libs: `common`, `database`, `proto`
- [ ] Environment configuration (.env.example)
- [ ] Docker Compose for PostgreSQL

**Directory Structure:**
```
social-backend/
├── apps/
│   └── user-service/
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── users/
│       │   ├── auth/
│       │   └── config/
│       └── test/
├── libs/
│   ├── common/
│   │   └── src/
│   │       ├── decorators/
│   │       ├── filters/
│   │       ├── guards/
│   │       ├── interceptors/
│   │       └── interfaces/
│   ├── database/
│   │   └── src/
│   │       ├── database.module.ts
│   │       ├── migrations/
│   │       └── entities/
│   └── proto/
│       └── src/
├── docker/
│   └── docker-compose.yml
├── .env.example
├── nest-cli.json
├── package.json
└── tsconfig.json
```

#### Day 3-4: Database Setup
```
Tasks:
├── Configure TypeORM/Drizzle with PostgreSQL
├── Create User entity
├── Create UserSettings entity
├── Create RefreshToken entity
├── Write database migrations
└── Set up connection pooling
```

**Database Tables:**
| Table | Fields | Purpose |
|-------|--------|---------|
| users | id, username, email, password_hash, display_name, bio, avatar_url, is_verified, is_active, follower_count, following_count, post_count, created_at, updated_at | User profiles |
| user_settings | user_id, email_notifications, push_notifications, notify_on_follow, notify_on_like, notify_on_reply, notify_on_mention, private_account | Preferences |
| refresh_tokens | id, user_id, token_hash, device_info, ip_address, expires_at, created_at | Session management |

#### Day 5: Docker Environment
```
Tasks:
├── Create docker-compose.yml
├── PostgreSQL container with volume
├── pgAdmin container (optional)
├── Health check configuration
└── Environment variables
```

**docker-compose.yml services:**
- PostgreSQL 16
- pgAdmin (dev only)
- Volumes for data persistence
- Network configuration

### Week 2: Authentication & User CRUD

#### Day 1-2: Authentication Module
```
Tasks:
├── Implement registration endpoint
├── Implement login endpoint
├── JWT access token generation
├── JWT refresh token flow
├── Password hashing (bcrypt/argon2)
├── Logout (token invalidation)
└── Password reset flow (optional)
```

**Auth Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /auth/register | Create account |
| POST | /auth/login | Get tokens |
| POST | /auth/refresh | Refresh access token |
| POST | /auth/logout | Invalidate refresh token |

**Security Considerations:**
- Password: min 8 chars, hashed with bcrypt (cost 12)
- Access token: 15 min expiry, signed with RS256
- Refresh token: 7 day expiry, stored hashed in DB
- Rate limit: 5 attempts per minute on login

#### Day 3-4: User CRUD
```
Tasks:
├── Get current user profile (GET /users/me)
├── Update profile (PATCH /users/me)
├── Get user by username (GET /users/:username)
├── Get user by ID (GET /users/:id)
├── Input validation (class-validator)
└── Response serialization (class-transformer)
```

**User Endpoints:**
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /users/me | Yes | Current user profile |
| PATCH | /users/me | Yes | Update profile |
| GET | /users/:username | No | Public profile |
| GET | /users/:id | No | Public profile by ID |

#### Day 5: Testing & Documentation
```
Tasks:
├── Unit tests for auth service
├── Unit tests for user service
├── E2E tests for auth flow
├── E2E tests for user endpoints
├── Swagger/OpenAPI documentation
└── README with setup instructions
```

**Test Coverage Targets:**
- Unit tests: 80%+ coverage
- E2E tests: All critical paths
- Auth flow: Registration → Login → Refresh → Logout

### Phase 1 Deliverables Checklist

```
Infrastructure:
[ ] NestJS monorepo initialized
[ ] TypeScript configured with strict mode
[ ] ESLint + Prettier configured
[ ] Docker Compose with PostgreSQL
[ ] Environment configuration

Database:
[ ] TypeORM/Drizzle configured
[ ] Users table with migrations
[ ] UserSettings table
[ ] RefreshTokens table
[ ] Connection pooling

Authentication:
[ ] Registration with email verification (optional)
[ ] Login with JWT tokens
[ ] Access token (15 min)
[ ] Refresh token (7 days)
[ ] Logout (token invalidation)
[ ] Password hashing

User Management:
[ ] Get current user
[ ] Update profile
[ ] Get user by username
[ ] Get user by ID
[ ] Input validation
[ ] Response serialization

Quality:
[ ] Unit tests (80%+ coverage)
[ ] E2E tests
[ ] Swagger documentation
[ ] README
```

### Phase 1 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| User can register | E2E test passes |
| User can login | JWT returned |
| Token refresh works | New access token issued |
| Profile update works | Changes persisted |
| Tests pass | 80%+ coverage |
| Docker works | `docker-compose up` successful |

---

## Phase 2: Post & Graph Services

### Duration: 2 Weeks

### Goals
- Implement Post Service with full CRUD
- Implement Graph Service for social relationships
- Set up gRPC communication between services
- Implement likes, replies, and reposts

### Week 1: Post Service & gRPC Setup

#### Day 1-2: gRPC Configuration
```
Tasks:
├── Install @nestjs/microservices and @grpc/grpc-js
├── Create proto/ directory structure
├── Define user.proto
├── Define post.proto
├── Configure proto compilation
├── Set up gRPC server in User Service
└── Create gRPC client module
```

**Proto Files:**
```
proto/
├── user.proto      # User service definitions
├── post.proto      # Post service definitions
├── common.proto    # Shared messages (Timestamp, Pagination)
└── health.proto    # Health check proto
```

**user.proto methods:**
- GetUser(user_id) → User
- GetUserByUsername(username) → User
- GetUsersByIds(user_ids[]) → User[]
- ValidateCredentials(email, password) → ValidationResult

#### Day 3-4: Post Service Setup
```
Tasks:
├── Create post-service app
├── Create Posts entity
├── Create Likes entity
├── Create Mentions entity
├── Create Hashtags entity
├── Database migrations
└── gRPC server configuration
```

**Database Tables:**
| Table | Fields | Purpose |
|-------|--------|---------|
| posts | id, author_id, content, media_urls[], reply_to_id, repost_of_id, like_count, reply_count, repost_count, is_deleted, created_at | Posts |
| likes | user_id, post_id, created_at | Like relationships |
| hashtags | id, tag, post_count, created_at | Hashtag registry |
| post_hashtags | post_id, hashtag_id | Post-hashtag junction |
| mentions | post_id, mentioned_user_id, created_at | @mentions |

#### Day 5: Post CRUD Implementation
```
Tasks:
├── Create post endpoint
├── Get post by ID
├── Delete post (soft delete)
├── Get posts by author
├── Extract mentions (@username)
├── Extract hashtags (#topic)
└── Validate content length (280 chars)
```

**Post Endpoints (REST):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /posts | Create post |
| GET | /posts/:id | Get post |
| DELETE | /posts/:id | Soft delete |
| GET | /users/:id/posts | User's posts |

**Post gRPC Methods:**
- CreatePost(author_id, content, media_urls) → Post
- GetPost(post_id) → Post
- GetPostsByIds(post_ids[]) → Post[]
- GetPostsByAuthor(author_id, cursor, limit) → PostList
- DeletePost(post_id, user_id) → Result

### Week 2: Likes, Replies & Graph Service

#### Day 1-2: Likes & Replies
```
Tasks:
├── Like post endpoint
├── Unlike post endpoint
├── Atomic like count update
├── Reply to post endpoint
├── Get replies for post
├── Reply threading (parent_id)
└── Prevent self-like
```

**Like Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /posts/:id/like | Like post |
| DELETE | /posts/:id/like | Unlike post |
| GET | /posts/:id/likes | Get likers (paginated) |

**Reply Endpoints:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /posts/:id/replies | Reply to post |
| GET | /posts/:id/replies | Get replies (paginated) |

**Atomic Counter Update:**
```sql
-- Like
UPDATE posts 
SET like_count = like_count + 1 
WHERE id = :post_id;

-- Unlike
UPDATE posts 
SET like_count = GREATEST(like_count - 1, 0) 
WHERE id = :post_id;
```

#### Day 3-4: Graph Service
```
Tasks:
├── Create graph-service app
├── Create Follows entity
├── Follow user endpoint
├── Unfollow user endpoint
├── Get followers (paginated)
├── Get following (paginated)
├── Update follower/following counts
└── Prevent self-follow
```

**Database Table:**
| Table | Fields | Purpose |
|-------|--------|---------|
| follows | follower_id, following_id, created_at | Social graph |

**Constraints:**
- PRIMARY KEY (follower_id, following_id)
- CHECK (follower_id != following_id)
- INDEX on follower_id
- INDEX on following_id

**Graph Endpoints (REST):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /users/:id/follow | Follow user |
| DELETE | /users/:id/follow | Unfollow user |
| GET | /users/:id/followers | Get followers |
| GET | /users/:id/following | Get following |

**Graph gRPC Methods:**
- FollowUser(follower_id, following_id) → Result
- UnfollowUser(follower_id, following_id) → Result
- GetFollowers(user_id, cursor, limit) → FollowList
- GetFollowing(user_id, cursor, limit) → FollowList
- GetFollowerIds(user_id, limit, offset) → string[]
- IsFollowing(follower_id, following_id) → bool

#### Day 5: Integration & Testing
```
Tasks:
├── gRPC communication: Post → User (get author info)
├── gRPC communication: Graph → User (validate user exists)
├── Integration tests
├── E2E tests for post flow
├── E2E tests for graph flow
└── Update Swagger documentation
```

**Integration Points:**
| Caller | Callee | Method | Purpose |
|--------|--------|--------|---------|
| Post Service | User Service | GetUser | Enrich post with author |
| Post Service | User Service | IncrementPostCount | Update user stats |
| Graph Service | User Service | GetUser | Validate user exists |
| Graph Service | User Service | IncrementFollowerCount | Update counts |

### Phase 2 Deliverables Checklist

```
gRPC Setup:
[ ] Proto files defined
[ ] Proto compilation configured
[ ] gRPC server in User Service
[ ] gRPC client module

Post Service:
[ ] Posts table with migrations
[ ] Likes table
[ ] Hashtags table
[ ] Mentions table
[ ] Create post (with mention/hashtag extraction)
[ ] Get post
[ ] Delete post (soft delete)
[ ] Like/unlike with atomic counters
[ ] Reply to post
[ ] Get replies

Graph Service:
[ ] Follows table with migrations
[ ] Follow user
[ ] Unfollow user
[ ] Get followers (paginated)
[ ] Get following (paginated)
[ ] Self-follow prevention
[ ] Counter updates via gRPC

Integration:
[ ] Post → User gRPC calls
[ ] Graph → User gRPC calls
[ ] Error handling for gRPC
[ ] Timeout configuration

Quality:
[ ] Unit tests
[ ] Integration tests
[ ] E2E tests
[ ] Updated Swagger docs
```

### Phase 2 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Post creation works | Post persisted with mentions/hashtags |
| Like/unlike works | Counters update atomically |
| Follow/unfollow works | Graph persisted correctly |
| gRPC calls work | Inter-service communication successful |
| Counts stay consistent | No negative counts |

---

## Phase 3: Event Streaming with Kafka

### Duration: 2 Weeks

### Goals
- Set up Kafka cluster
- Implement event producers in services
- Implement transactional outbox pattern
- Create event consumers
- Ensure exactly-once semantics

### Week 1: Kafka Setup & Producers

#### Day 1-2: Kafka Infrastructure
```
Tasks:
├── Add Kafka to docker-compose
├── Add Zookeeper (or KRaft mode)
├── Create Kafka topics
├── Configure topic partitions
├── Set up Kafka UI (optional)
└── Create shared Kafka module
```

**Docker Services:**
- Zookeeper (or KRaft)
- Kafka (3 brokers for local, 1 for dev)
- Kafka UI (Kafdrop/Redpanda Console)

**Topics Configuration:**
| Topic | Partitions | Retention | Key |
|-------|------------|-----------|-----|
| user.events | 6 | 7 days | user_id |
| post.events | 12 | 7 days | author_id |
| graph.events | 6 | 7 days | following_id |

**Shared Kafka Module:**
```
libs/kafka/
├── src/
│   ├── kafka.module.ts
│   ├── kafka.service.ts
│   ├── kafka.producer.ts
│   ├── kafka.consumer.ts
│   ├── interfaces/
│   │   └── event.interface.ts
│   └── decorators/
│       └── event-handler.decorator.ts
```

#### Day 3-4: Transactional Outbox Pattern
```
Tasks:
├── Create outbox table
├── Create outbox entity
├── Implement outbox writer
├── Implement outbox poller
├── Atomic DB + outbox writes
└── Outbox cleanup job
```

**Outbox Table:**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| aggregate_type | VARCHAR | 'post', 'user', 'follow' |
| aggregate_id | UUID | Entity ID |
| event_type | VARCHAR | 'post.created', etc. |
| payload | JSONB | Event data |
| created_at | TIMESTAMP | When created |
| published_at | TIMESTAMP | When published (nullable) |

**Outbox Flow:**
```
1. Service writes entity + outbox entry (same transaction)
2. Outbox poller reads unpublished entries
3. Poller publishes to Kafka
4. On ACK, mark as published (or delete)
5. Cleanup job removes old published entries
```

#### Day 5: Event Producers
```
Tasks:
├── User Service: user.created, user.updated
├── Post Service: post.created, post.deleted, post.liked
├── Graph Service: user.followed, user.unfollowed
├── Event envelope structure
└── Correlation ID propagation
```

**Event Structure:**
```typescript
interface Event<T> {
  event_id: string;        // UUID
  event_type: string;      // 'post.created'
  aggregate_type: string;  // 'post'
  aggregate_id: string;    // post_id
  timestamp: string;       // ISO8601
  correlation_id: string;  // Request trace ID
  data: T;                 // Event-specific payload
}
```

**Events by Service:**
| Service | Event | Trigger |
|---------|-------|---------|
| User | user.created | Registration |
| User | user.updated | Profile update |
| Post | post.created | New post |
| Post | post.deleted | Post deletion |
| Post | post.liked | Like action |
| Post | post.unliked | Unlike action |
| Post | post.replied | Reply created |
| Graph | user.followed | Follow action |
| Graph | user.unfollowed | Unfollow action |

### Week 2: Event Consumers & Exactly-Once

#### Day 1-2: Consumer Infrastructure
```
Tasks:
├── Create consumer group configuration
├── Implement base consumer class
├── Partition assignment strategy
├── Offset management
├── Error handling
└── Dead letter queue setup
```

**Consumer Groups:**
| Group | Topics | Purpose |
|-------|--------|---------|
| user-counter-sync | graph.events | Update follower counts |
| post-counter-sync | post.events | Update post counts |
| timeline-fanout | post.events, graph.events | Timeline updates |
| notification-processor | post.events, graph.events | Create notifications |
| search-indexer | post.events, user.events | Index documents |

**Consumer Configuration:**
```typescript
{
  groupId: 'user-counter-sync',
  sessionTimeout: 30000,
  heartbeatInterval: 10000,
  maxBytesPerPartition: 1048576,
  autoCommit: false,  // Manual commit for exactly-once
}
```

#### Day 3-4: Idempotent Consumers
```
Tasks:
├── Create processed_events table
├── Deduplication check before processing
├── Transactional processing
├── Manual offset commit
├── Retry with backoff
└── DLQ routing for permanent failures
```

**Processed Events Table:**
| Column | Type | Description |
|--------|------|-------------|
| event_id | UUID | Primary key |
| consumer_group | VARCHAR | Which consumer processed |
| processed_at | TIMESTAMP | When processed |

**Idempotent Processing Flow:**
```
1. Receive message from Kafka
2. Check if event_id exists in processed_events
3. If exists → skip (already processed)
4. If not exists → BEGIN transaction
5. Process event (update DB, etc.)
6. Insert into processed_events
7. COMMIT transaction
8. Commit Kafka offset
```

#### Day 5: Integration & Testing
```
Tasks:
├── User Service: Consume graph.events for counter sync
├── Post Service: Consume post events for counter sync
├── End-to-end event flow test
├── Failure scenario testing
├── DLQ verification
└── Documentation
```

**Test Scenarios:**
| Scenario | Expected Behavior |
|----------|-------------------|
| Happy path | Event processed, offset committed |
| Duplicate event | Skipped, no side effects |
| Processing failure | Retry with backoff |
| Permanent failure | Route to DLQ |
| Consumer restart | Resume from last committed offset |

### Phase 3 Deliverables Checklist

```
Kafka Infrastructure:
[ ] Kafka in docker-compose
[ ] Topics created with correct partitions
[ ] Kafka UI for debugging
[ ] Shared Kafka module

Transactional Outbox:
[ ] Outbox table
[ ] Atomic writes (entity + outbox)
[ ] Outbox poller service
[ ] Publish confirmation
[ ] Cleanup job

Event Producers:
[ ] User Service events
[ ] Post Service events
[ ] Graph Service events
[ ] Event envelope structure
[ ] Correlation ID propagation

Event Consumers:
[ ] Consumer group configuration
[ ] Base consumer class
[ ] Offset management
[ ] Error handling

Exactly-Once Semantics:
[ ] Processed events table
[ ] Deduplication check
[ ] Transactional processing
[ ] Manual offset commit
[ ] DLQ setup

Quality:
[ ] Event flow tests
[ ] Failure scenario tests
[ ] DLQ tests
[ ] Documentation
```

### Phase 3 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Events published | Outbox → Kafka flow works |
| Events consumed | Consumers process events |
| No duplicates | Idempotency works |
| Failures handled | DLQ receives failed events |
| Counters stay in sync | Eventually consistent |

---

## Phase 4: Timeline & Caching

### Duration: 2 Weeks

### Goals
- Set up Redis cluster
- Implement Timeline Service
- Implement fan-out on write
- Set up caching for users and posts
- Implement home timeline and user timeline

### Week 1: Redis Setup & Caching

#### Day 1-2: Redis Infrastructure
```
Tasks:
├── Add Redis to docker-compose
├── Configure Redis persistence (RDB + AOF)
├── Create shared Redis module
├── Connection pooling
├── Health checks
└── Redis Commander UI (optional)
```

**Redis Configuration:**
```
Mode: Standalone (dev) / Cluster (prod)
Persistence: RDB snapshots + AOF
Max Memory: 256MB (dev) / based on needs (prod)
Eviction Policy: volatile-lru
```

**Shared Redis Module:**
```
libs/redis/
├── src/
│   ├── redis.module.ts
│   ├── redis.service.ts
│   ├── cache.service.ts
│   └── interfaces/
│       └── cache-options.interface.ts
```

#### Day 3-4: Cache-Aside Pattern
```
Tasks:
├── User cache (Hash)
├── Post cache (Hash)
├── Cache-aside implementation
├── TTL configuration
├── Cache invalidation on updates
└── Cache warming (optional)
```

**Cache Keys & TTLs:**
| Key Pattern | Type | TTL | Content |
|-------------|------|-----|---------|
| user:{id} | Hash | 1h | User profile |
| user:username:{name} | String | 1h | user_id |
| post:{id} | Hash | 30m | Post data |
| user:posts:{id} | List | 15m | User's post IDs |

**Cache-Aside Flow:**
```typescript
async getUser(userId: string): Promise<User> {
  // 1. Check cache
  const cached = await this.redis.hgetall(`user:${userId}`);
  if (cached && Object.keys(cached).length > 0) {
    return this.deserializeUser(cached);
  }
  
  // 2. Cache miss - query DB
  const user = await this.userRepository.findById(userId);
  if (!user) throw new NotFoundException();
  
  // 3. Populate cache
  await this.redis.hset(`user:${userId}`, this.serializeUser(user));
  await this.redis.expire(`user:${userId}`, 3600);
  
  return user;
}
```

#### Day 5: Cache Invalidation
```
Tasks:
├── Invalidate on user update
├── Invalidate on post update
├── Invalidate on delete
├── Event-driven invalidation
└── Testing cache behavior
```

**Invalidation Triggers:**
| Event | Keys Invalidated |
|-------|-----------------|
| user.updated | user:{id}, user:username:{old}, user:username:{new} |
| post.updated | post:{id} |
| post.deleted | post:{id}, remove from timelines |
| post.liked | post:{id} (like_count changed) |

### Week 2: Timeline Service

#### Day 1-2: Timeline Service Setup
```
Tasks:
├── Create timeline-service app
├── gRPC server configuration
├── Redis connection
├── Timeline data structure design
├── Consume post.events
├── Consume graph.events
```

**Timeline Redis Structure:**
```
Key: timeline:{user_id}
Type: Sorted Set
Score: Unix timestamp (milliseconds)
Member: post_id

Max Size: 1000 entries per timeline
```

**Timeline gRPC Methods:**
- GetHomeTimeline(user_id, cursor, limit) → TimelineResponse
- GetUserTimeline(user_id, cursor, limit) → TimelineResponse

#### Day 3-4: Fan-Out on Write
```
Tasks:
├── Consume post.created event
├── Get author's followers (gRPC to Graph Service)
├── Batch write to follower timelines
├── Handle large follower counts (>10K)
├── Timeline trimming (keep last 1000)
└── Remove post on delete
```

**Fan-Out Flow:**
```
1. Receive post.created event
2. Get follower IDs from Graph Service
3. For each batch of followers:
   - ZADD timeline:{follower_id} {timestamp} {post_id}
4. Trim timelines: ZREMRANGEBYRANK timeline:{id} 0 -1001
5. Add to author's own timeline
```

**Hybrid Strategy for Celebrities:**
```
IF author.follower_count > 10000:
  - Don't fan-out immediately
  - Mark post for "pull" strategy
  - Fans of celebrities pull on read

ELSE:
  - Normal fan-out on write
```

#### Day 5: Timeline API & Testing
```
Tasks:
├── Home timeline endpoint
├── User timeline endpoint
├── Cursor-based pagination
├── Enrich posts with author info
├── Integration tests
└── Performance testing
```

**Timeline Endpoints (REST via Gateway):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /timeline/home | Home timeline |
| GET | /timeline/user/:id | User's posts |

**Pagination:**
```
Request: GET /timeline/home?cursor=1704067200000&limit=20
Response: {
  posts: [...],
  next_cursor: "1704066000000",
  has_more: true
}
```

### Phase 4 Deliverables Checklist

```
Redis Infrastructure:
[ ] Redis in docker-compose
[ ] Persistence configured
[ ] Shared Redis module
[ ] Connection pooling
[ ] Health checks

Caching:
[ ] User cache (Hash)
[ ] Post cache (Hash)
[ ] Cache-aside implementation
[ ] TTL configuration
[ ] Cache invalidation

Timeline Service:
[ ] Timeline service created
[ ] gRPC server configured
[ ] Redis connection
[ ] Kafka consumers

Fan-Out:
[ ] Consume post.created
[ ] Get followers via gRPC
[ ] Batch writes to timelines
[ ] Handle large follower counts
[ ] Timeline trimming
[ ] Remove on post delete

Timeline API:
[ ] Home timeline endpoint
[ ] User timeline endpoint
[ ] Cursor-based pagination
[ ] Post enrichment

Quality:
[ ] Cache behavior tests
[ ] Fan-out tests
[ ] Timeline API tests
[ ] Performance tests
```

### Phase 4 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Cache hit rate | > 80% for users/posts |
| Fan-out works | Posts appear in follower timelines |
| Timeline loads fast | < 100ms for 20 posts |
| Pagination works | Cursor-based navigation |
| Large accounts handled | Hybrid strategy works |

---

## Phase 5: Notifications & Real-time

### Duration: 2 Weeks

### Goals
- Implement Notification Service
- Set up WebSocket connections
- Implement Redis Pub/Sub
- Real-time notification delivery
- Notification preferences

### Week 1: Notification Service

#### Day 1-2: Notification Service Setup
```
Tasks:
├── Create notification-service app
├── Create notifications table
├── gRPC server configuration
├── Kafka consumer setup
├── Notification types enum
└── Notification templates
```

**Notifications Table:**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Recipient |
| type | VARCHAR | follow, like, reply, mention |
| actor_id | UUID | Who triggered |
| entity_type | VARCHAR | post, user |
| entity_id | UUID | Related entity |
| message | VARCHAR | Rendered message |
| is_read | BOOLEAN | Read status |
| created_at | TIMESTAMP | When created |

**Notification Types:**
| Type | Trigger | Template |
|------|---------|----------|
| follow | user.followed | "{actor} started following you" |
| like | post.liked | "{actor} liked your post" |
| reply | post.replied | "{actor} replied to your post" |
| mention | mention.created | "{actor} mentioned you" |
| repost | post.reposted | "{actor} reposted your post" |

#### Day 3-4: Event Consumption
```
Tasks:
├── Consume post.liked events
├── Consume post.replied events
├── Consume user.followed events
├── Consume mention.created events
├── Check notification preferences
├── Create notification records
└── Notification aggregation (batching)
```

**Consumption Flow:**
```
1. Receive event (e.g., post.liked)
2. Extract: actor_id, target_user_id, entity_id
3. Fetch user settings (cached)
4. Check if notification type enabled
5. If disabled → skip
6. If enabled → create notification
7. Publish to Redis Pub/Sub for real-time
```

**Aggregation Strategy:**
```
Problem: 50 likes in 1 minute = 50 notifications

Solution:
- Group by (user_id, type, entity_id, time_window)
- Update existing notification if within window
- "John and 49 others liked your post"
- Store actor_ids in array (limit 100)
```

#### Day 5: Notification API
```
Tasks:
├── Get notifications endpoint
├── Mark as read endpoint
├── Get unread count endpoint
├── Cursor-based pagination
├── gRPC methods for internal use
└── Unit tests
```

**Notification Endpoints (REST):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /notifications | Get notifications (paginated) |
| POST | /notifications/read | Mark as read |
| GET | /notifications/unread-count | Get unread count |

**Notification gRPC Methods:**
- CreateNotification(user_id, type, actor_id, entity) → Notification
- GetNotifications(user_id, cursor, limit) → NotificationList
- MarkAsRead(notification_ids[]) → Result
- GetUnreadCount(user_id) → int

### Week 2: Real-time Delivery

#### Day 1-2: WebSocket Gateway
```
Tasks:
├── WebSocket gateway in API Gateway
├── Connection authentication (JWT)
├── Connection management (user → socket mapping)
├── Heartbeat/ping-pong
├── Graceful disconnect handling
└── Connection limits per user
```

**WebSocket Events:**
| Event | Direction | Description |
|-------|-----------|-------------|
| connect | Client → Server | Initial connection with JWT |
| authenticated | Server → Client | Auth success confirmation |
| notification | Server → Client | New notification push |
| ping | Client → Server | Keep-alive |
| pong | Server → Client | Keep-alive response |

**Connection Management:**
```typescript
// In-memory mapping (single instance)
Map<userId, Set<socketId>>

// For multi-instance, use Redis
SADD ws:connections:{userId} {instanceId}:{socketId}
```

#### Day 3-4: Redis Pub/Sub
```
Tasks:
├── Notification Service publishes to channel
├── API Gateway subscribes to channels
├── Subscribe on user connect
├── Unsubscribe on disconnect
├── Multi-instance coordination
└── Message format
```

**Pub/Sub Flow:**
```
1. Notification Service creates notification
2. Publishes to channel: notifications:{user_id}
3. API Gateway (subscribed) receives message
4. Gateway finds WebSocket connection for user
5. Pushes notification to client
```

**Channel Pattern:**
```
Channel: notifications:{user_id}
Message: JSON notification object
```

**Multi-Instance Handling:**
```
Option A: All instances subscribe to all channels (simple, more memory)
Option B: Use Redis Cluster pub/sub sharding
Option C: Dedicated notification push service
```

#### Day 5: Integration & Testing
```
Tasks:
├── End-to-end notification flow
├── WebSocket connection tests
├── Pub/Sub delivery tests
├── Offline user handling
├── Reconnection handling
└── Load testing
```

**Test Scenarios:**
| Scenario | Expected |
|----------|----------|
| User online | Real-time push via WebSocket |
| User offline | Notification stored, available on fetch |
| User reconnects | Fetch missed notifications |
| Multiple tabs | All tabs receive notification |
| Preferences disabled | No notification created |

### Phase 5 Deliverables Checklist

```
Notification Service:
[ ] Notification service created
[ ] Notifications table
[ ] Kafka consumers
[ ] Notification types
[ ] Preference checking
[ ] Aggregation logic

Notification API:
[ ] Get notifications
[ ] Mark as read
[ ] Unread count
[ ] Pagination
[ ] gRPC methods

WebSocket:
[ ] WebSocket gateway
[ ] JWT authentication
[ ] Connection management
[ ] Heartbeat
[ ] Graceful disconnect

Redis Pub/Sub:
[ ] Publish on notification create
[ ] Subscribe on connect
[ ] Unsubscribe on disconnect
[ ] Message delivery

Integration:
[ ] End-to-end flow
[ ] Multi-tab support
[ ] Offline handling
[ ] Reconnection

Quality:
[ ] Unit tests
[ ] Integration tests
[ ] WebSocket tests
[ ] Load tests
```

### Phase 5 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Notifications created | Events trigger notifications |
| Preferences respected | Disabled types don't notify |
| Real-time delivery | < 1s from event to client |
| Offline handling | Stored and fetchable |
| Unread count accurate | Matches actual unread |

---

## Phase 6: Search & Discovery

### Duration: 2 Weeks

### Goals
- Set up Elasticsearch
- Implement Search Service
- Index users and posts
- Full-text search functionality
- Trending hashtags

### Week 1: Elasticsearch Setup & Indexing

#### Day 1-2: Elasticsearch Infrastructure
```
Tasks:
├── Add Elasticsearch to docker-compose
├── Create indices (users, posts, hashtags)
├── Define mappings
├── Configure analyzers
├── Create shared ES module
└── Health checks
```

**Docker Services:**
- Elasticsearch 8.x (single node for dev)
- Kibana (optional, for debugging)

**Index Mappings:**

**Users Index:**
```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "username": { 
        "type": "text",
        "fields": { "keyword": { "type": "keyword" } }
      },
      "display_name": { "type": "text" },
      "bio": { "type": "text" },
      "follower_count": { "type": "integer" },
      "is_verified": { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}
```

**Posts Index:**
```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "author_id": { "type": "keyword" },
      "author_username": { "type": "keyword" },
      "content": { 
        "type": "text",
        "analyzer": "standard"
      },
      "hashtags": { "type": "keyword" },
      "mentions": { "type": "keyword" },
      "like_count": { "type": "integer" },
      "created_at": { "type": "date" }
    }
  }
}
```

#### Day 3-4: Search Service & Consumers
```
Tasks:
├── Create search-service app
├── Kafka consumers for indexing
├── Index user on user.created
├── Update user on user.updated
├── Index post on post.created
├── Remove post on post.deleted
└── Bulk indexing for efficiency
```

**Consumed Events:**
| Event | Action |
|-------|--------|
| user.created | Index user document |
| user.updated | Update user document |
| user.deleted | Delete user document |
| post.created | Index post document |
| post.deleted | Delete post document |
| post.liked | Update like_count |

**Indexing Flow:**
```
1. Consume event from Kafka
2. Transform to ES document
3. Index/update/delete in Elasticsearch
4. Handle failures (retry, DLQ)
```

#### Day 5: gRPC Server Setup
```
Tasks:
├── Define search.proto
├── gRPC server configuration
├── Search service interface
├── Error handling
└── Unit tests
```

**search.proto methods:**
- SearchUsers(query, limit, offset) → UserSearchResults
- SearchPosts(query, filters, limit, offset) → PostSearchResults
- SearchHashtags(query, limit) → HashtagResults
- GetTrendingHashtags(limit, time_window) → TrendingHashtags

### Week 2: Search API & Trending

#### Day 1-2: Search Implementation
```
Tasks:
├── User search (username, display_name, bio)
├── Post search (content, hashtags)
├── Relevance scoring
├── Filters (date range, author)
├── Highlighting matches
└── Pagination
```

**User Search Query:**
```json
{
  "query": {
    "multi_match": {
      "query": "search term",
      "fields": ["username^3", "display_name^2", "bio"],
      "type": "best_fields",
      "fuzziness": "AUTO"
    }
  },
  "sort": [
    { "_score": "desc" },
    { "follower_count": "desc" }
  ]
}
```

**Post Search Query:**
```json
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "content": "search term"
          }
        }
      ],
      "filter": [
        { "range": { "created_at": { "gte": "now-7d" } } }
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "like_count": "desc" }
  ]
}
```

#### Day 3-4: Trending Hashtags
```
Tasks:
├── Track hashtag usage in posts
├── Time-windowed aggregation
├── Calculate trending score
├── Cache trending results
├── Periodic refresh job
└── API endpoint
```

**Trending Algorithm:**
```
Score = (recent_count / total_count) * log(total_count + 1)

Where:
- recent_count: Posts with hashtag in last 24h
- total_count: All-time posts with hashtag
```

**Trending Endpoint:**
```
GET /trending/hashtags?limit=10&window=24h

Response:
{
  "hashtags": [
    { "tag": "javascript", "post_count": 1234, "change": "+15%" },
    { "tag": "nestjs", "post_count": 567, "change": "+42%" }
  ]
}
```

#### Day 5: API Gateway Integration
```
Tasks:
├── Search endpoints in API Gateway
├── Rate limiting for search
├── Response caching
├── Integration tests
├── Performance testing
└── Documentation
```

**Search Endpoints (REST):**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /search/users?q= | Search users |
| GET | /search/posts?q= | Search posts |
| GET | /search/hashtags?q= | Search hashtags |
| GET | /trending/hashtags | Get trending |

### Phase 6 Deliverables Checklist

```
Elasticsearch Infrastructure:
[ ] Elasticsearch in docker-compose
[ ] Users index with mappings
[ ] Posts index with mappings
[ ] Hashtags index
[ ] Shared ES module

Search Service:
[ ] Search service created
[ ] gRPC server
[ ] Kafka consumers
[ ] User indexing
[ ] Post indexing
[ ] Delete handling

Search API:
[ ] User search
[ ] Post search
[ ] Hashtag search
[ ] Relevance scoring
[ ] Filtering
[ ] Pagination

Trending:
[ ] Hashtag tracking
[ ] Time-windowed aggregation
[ ] Trending calculation
[ ] Cache with refresh
[ ] API endpoint

Integration:
[ ] API Gateway endpoints
[ ] Rate limiting
[ ] Response caching
[ ] Error handling

Quality:
[ ] Unit tests
[ ] Integration tests
[ ] Performance tests
[ ] Documentation
```

### Phase 6 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| User search works | Finds users by name/username |
| Post search works | Finds posts by content |
| Relevance is good | Best matches first |
| Trending updates | Reflects recent activity |
| Search is fast | < 200ms response |

---

## Phase 7: Reliability & Security

### Duration: 2 Weeks

### Goals
- Implement circuit breakers
- Implement rate limiting
- Add health checks
- Security hardening
- Input validation
- Error handling improvements

### Week 1: Reliability Patterns

#### Day 1-2: Circuit Breakers
```
Tasks:
├── Install circuit breaker library (opossum/cockatiel)
├── Wrap gRPC client calls
├── Wrap external service calls
├── Configure thresholds
├── Fallback strategies
├── Circuit state monitoring
└── Metrics for circuit state
```

**Circuit Breaker Configuration:**
```typescript
{
  timeout: 3000,           // 3 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000,     // 30 seconds
  volumeThreshold: 10      // Min requests before tripping
}
```

**Circuit States:**
| State | Behavior |
|-------|----------|
| CLOSED | Normal operation |
| OPEN | Fail fast, return fallback |
| HALF_OPEN | Allow limited requests to test |

**Fallback Strategies:**
| Service | Fallback |
|---------|----------|
| User Service | Return cached user data |
| Post Service | Return cached post data |
| Timeline Service | Return stale timeline from DB |
| Search Service | Return empty results with error flag |

#### Day 3-4: Retry & Timeout
```
Tasks:
├── Configure gRPC timeouts
├── Implement retry interceptor
├── Exponential backoff
├── Jitter to prevent thundering herd
├── Retry budgets
└── Deadline propagation
```

**Retry Configuration:**
```typescript
{
  maxRetries: 3,
  initialDelay: 100,    // ms
  maxDelay: 5000,       // ms
  multiplier: 2,
  jitter: 0.1,          // 10%
  retryableStatuses: [
    Status.UNAVAILABLE,
    Status.DEADLINE_EXCEEDED,
    Status.RESOURCE_EXHAUSTED
  ]
}
```

**Deadline Propagation:**
```
Client sets deadline: 5 seconds
Gateway receives: 5 seconds remaining
Gateway calls User Service with: 4.8 seconds (subtract processing time)
User Service has: 4.8 seconds to complete
```

#### Day 5: Health Checks
```
Tasks:
├── Liveness probe (is process alive?)
├── Readiness probe (can handle traffic?)
├── gRPC health check protocol
├── HTTP health endpoints
├── Dependency health checks
├── Graceful shutdown
```

**Health Check Endpoints:**
| Endpoint | Type | Checks |
|----------|------|--------|
| /health/live | Liveness | Process is running |
| /health/ready | Readiness | DB, Redis, Kafka connected |

**Dependency Checks:**
```typescript
async checkReadiness(): Promise<HealthCheckResult> {
  const checks = await Promise.all([
    this.checkDatabase(),
    this.checkRedis(),
    this.checkKafka(),
  ]);
  
  return {
    status: checks.every(c => c.healthy) ? 'healthy' : 'unhealthy',
    checks
  };
}
```

### Week 2: Security & Rate Limiting

#### Day 1-2: Rate Limiting
```
Tasks:
├── Token bucket algorithm
├── Redis-based counters
├── Per-user limits
├── Per-IP limits (unauthenticated)
├── Per-endpoint limits
├── Rate limit headers
└── 429 response handling
```

**Rate Limit Configuration:**
| Endpoint Category | Limit | Window | Key |
|-------------------|-------|--------|-----|
| Authentication | 5 | 1 min | IP |
| Post creation | 30 | 1 hour | User |
| Follow/unfollow | 100 | 1 day | User |
| Timeline | 100 | 1 min | User |
| Search | 30 | 1 min | User |
| General API | 1000 | 1 hour | User |

**Token Bucket Implementation:**
```typescript
async isAllowed(key: string, limit: number, window: number): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - (window * 1000);
  
  // Remove old entries
  await this.redis.zremrangebyscore(key, 0, windowStart);
  
  // Count current requests
  const count = await this.redis.zcard(key);
  
  if (count >= limit) {
    return false;
  }
  
  // Add current request
  await this.redis.zadd(key, now, `${now}-${Math.random()}`);
  await this.redis.expire(key, window);
  
  return true;
}
```

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
Retry-After: 60 (on 429)
```

#### Day 3-4: Input Validation & Sanitization
```
Tasks:
├── class-validator for DTOs
├── Custom validation decorators
├── Content sanitization (XSS prevention)
├── URL validation
├── SQL injection prevention (parameterized queries)
├── File upload validation (if any)
└── Error message sanitization
```

**Validation Examples:**
```typescript
class CreatePostDto {
  @IsString()
  @Length(1, 280)
  @Transform(({ value }) => sanitizeHtml(value))
  content: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUrl({}, { each: true })
  mediaUrls?: string[];
}

class CreateUserDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,30}$/)
  username: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
}
```

#### Day 5: Security Headers & Final Hardening
```
Tasks:
├── Helmet.js middleware
├── CORS configuration
├── Content Security Policy
├── HTTPS enforcement
├── Secure cookie settings
├── Remove sensitive headers
└── Security audit
```

**Security Headers:**
```typescript
app.use(helmet({
  contentSecurityPolicy: true,
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: true,
  dnsPrefetchControl: true,
  frameguard: true,
  hidePoweredBy: true,
  hsts: true,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: true,
  referrerPolicy: true,
  xssFilter: true,
}));
```

### Phase 7 Deliverables Checklist

```
Circuit Breakers:
[ ] Circuit breaker library integrated
[ ] gRPC clients wrapped
[ ] Thresholds configured
[ ] Fallback strategies
[ ] State monitoring

Retry & Timeout:
[ ] gRPC timeouts
[ ] Retry interceptor
[ ] Exponential backoff with jitter
[ ] Deadline propagation

Health Checks:
[ ] Liveness probe
[ ] Readiness probe
[ ] gRPC health protocol
[ ] Dependency checks
[ ] Graceful shutdown

Rate Limiting:
[ ] Token bucket implementation
[ ] Per-user limits
[ ] Per-IP limits
[ ] Per-endpoint limits
[ ] Rate limit headers
[ ] 429 handling

Security:
[ ] Input validation
[ ] Content sanitization
[ ] Security headers (Helmet)
[ ] CORS configuration
[ ] Secure cookies
[ ] Security audit

Quality:
[ ] Circuit breaker tests
[ ] Rate limit tests
[ ] Validation tests
[ ] Security tests
```

### Phase 7 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Circuit breaker works | Opens on failures, recovers |
| Rate limiting works | Returns 429 when exceeded |
| Health checks work | K8s can use for probes |
| Validation catches bad input | Invalid requests rejected |
| Security headers present | Security scan passes |

---

## Phase 8: Observability & Deployment

### Duration: 2 Weeks

### Goals
- Implement structured logging
- Set up Prometheus metrics
- Implement distributed tracing
- Create Grafana dashboards
- Kubernetes deployment
- CI/CD pipeline

### Week 1: Observability

#### Day 1-2: Structured Logging
```
Tasks:
├── Configure Pino/Winston logger
├── JSON log format
├── Log levels configuration
├── Correlation ID propagation
├── Request/response logging
├── Error logging with stack traces
└── Log aggregation setup (optional)
```

**Log Format:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "service": "post-service",
  "trace_id": "abc123",
  "span_id": "def456",
  "user_id": "user-789",
  "message": "Post created successfully",
  "data": {
    "post_id": "post-123",
    "content_length": 140
  },
  "duration_ms": 45
}
```

**Log Levels:**
| Level | Usage |
|-------|-------|
| error | Errors requiring attention |
| warn | Unexpected but handled situations |
| info | Important business events |
| debug | Detailed debugging info (dev only) |

#### Day 3-4: Metrics & Tracing
```
Tasks:
├── Prometheus client setup
├── Default metrics (CPU, memory, etc.)
├── Custom application metrics
├── OpenTelemetry setup
├── Trace context propagation
├── Span creation for operations
└── Jaeger integration
```

**Custom Metrics:**
```typescript
// Counters
posts_created_total
posts_deleted_total
likes_total
follows_total

// Histograms
http_request_duration_seconds
grpc_request_duration_seconds
kafka_message_processing_duration_seconds

// Gauges
active_websocket_connections
kafka_consumer_lag
redis_connection_pool_size
```

**Tracing Setup:**
```typescript
// Trace context propagation
Headers:
- traceparent: 00-{trace-id}-{span-id}-{flags}
- tracestate: (optional vendor data)

Spans to create:
- HTTP request handling
- gRPC calls
- Database queries
- Redis operations
- Kafka produce/consume
```

#### Day 5: Dashboards & Alerts
```
Tasks:
├── Grafana setup
├── Service health dashboard
├── Business metrics dashboard
├── Alert rules (Prometheus)
├── Alert routing (optional)
└── Documentation
```

**Dashboard Panels:**
| Panel | Metrics |
|-------|---------|
| Request Rate | requests_total by service |
| Error Rate | 5xx / total requests |
| Latency (p50, p99) | request_duration histogram |
| Active Users | active_websocket_connections |
| Kafka Lag | consumer_lag by topic |
| Cache Hit Rate | cache_hits / (hits + misses) |

**Alert Rules:**
```yaml
- alert: HighErrorRate
  expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.01
  for: 5m
  labels:
    severity: critical

- alert: HighLatency
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 0.5
  for: 5m
  labels:
    severity: warning

- alert: KafkaLagHigh
  expr: kafka_consumer_lag > 10000
  for: 10m
  labels:
    severity: warning
```

### Week 2: Kubernetes & CI/CD

#### Day 1-2: Kubernetes Manifests
```
Tasks:
├── Deployment manifests for each service
├── Service definitions
├── ConfigMaps for configuration
├── Secrets for sensitive data
├── Ingress configuration
├── Horizontal Pod Autoscaler
└── Network policies (optional)
```

**Directory Structure:**
```
k8s/
├── base/
│   ├── namespace.yaml
│   ├── configmap.yaml
│   └── secrets.yaml
├── services/
│   ├── api-gateway/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── hpa.yaml
│   ├── user-service/
│   ├── post-service/
│   ├── timeline-service/
│   ├── graph-service/
│   ├── notification-service/
│   └── search-service/
├── infrastructure/
│   ├── redis/
│   ├── kafka/
│   └── elasticsearch/
└── ingress/
    └── ingress.yaml
```

**Example Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: post-service
  namespace: social-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: post-service
  template:
    spec:
      containers:
      - name: post-service
        image: social-app/post-service:latest
        ports:
        - containerPort: 50051
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          grpc:
            port: 50051
          initialDelaySeconds: 10
        readinessProbe:
          grpc:
            port: 50051
          initialDelaySeconds: 5
```

#### Day 3-4: CI/CD Pipeline
```
Tasks:
├── GitHub Actions workflow
├── Build and test stage
├── Docker image build
├── Push to container registry
├── Deploy to staging
├── Deploy to production (manual gate)
└── Rollback strategy
```

**CI Pipeline (.github/workflows/ci.yml):**
```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run test:e2e

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
```

**CD Pipeline (.github/workflows/cd.yml):**
```yaml
name: CD
on:
  push:
    branches: [main]

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to staging
        run: |
          kubectl apply -k k8s/overlays/staging

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production  # Manual approval
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to production
        run: |
          kubectl apply -k k8s/overlays/production
```

#### Day 5: Documentation & Polish
```
Tasks:
├── API documentation (Swagger/OpenAPI)
├── Architecture documentation
├── Deployment guide
├── Runbook for operations
├── README updates
├── Demo preparation
└── Final testing
```

**Documentation Structure:**
```
docs/
├── architecture/
│   ├── overview.md
│   ├── services.md
│   ├── data-flow.md
│   └── diagrams/
├── api/
│   ├── rest-api.md
│   └── grpc-api.md
├── deployment/
│   ├── local-setup.md
│   ├── kubernetes.md
│   └── ci-cd.md
├── operations/
│   ├── runbook.md
│   ├── monitoring.md
│   └── troubleshooting.md
└── development/
    ├── contributing.md
    └── coding-standards.md
```

### Phase 8 Deliverables Checklist

```
Logging:
[ ] Structured JSON logging
[ ] Log levels configured
[ ] Correlation ID propagation
[ ] Request/response logging
[ ] Error logging

Metrics:
[ ] Prometheus client
[ ] Default metrics
[ ] Custom application metrics
[ ] Metrics endpoint

Tracing:
[ ] OpenTelemetry setup
[ ] Trace context propagation
[ ] Span creation
[ ] Jaeger integration

Dashboards:
[ ] Grafana setup
[ ] Service health dashboard
[ ] Business metrics dashboard
[ ] Alert rules

Kubernetes:
[ ] Deployment manifests
[ ] Service definitions
[ ] ConfigMaps
[ ] Secrets
[ ] Ingress
[ ] HPA

CI/CD:
[ ] GitHub Actions CI
[ ] Docker builds
[ ] Automated tests
[ ] Staging deployment
[ ] Production deployment

Documentation:
[ ] API documentation
[ ] Architecture docs
[ ] Deployment guide
[ ] Runbook
[ ] README
```

### Phase 8 Success Criteria

| Criteria | Measurement |
|----------|-------------|
| Logs are searchable | Can find requests by trace_id |
| Metrics are collected | Prometheus scrapes successfully |
| Traces are visible | End-to-end traces in Jaeger |
| Dashboards work | Grafana shows real data |
| K8s deployment works | All pods running |
| CI/CD works | Push triggers pipeline |

---

## Summary: 8-Phase Implementation

```
┌─────────────────────────────────────────────────────────────────────┐
│                     16-WEEK IMPLEMENTATION PLAN                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Phase 1 (Weeks 1-2)     Phase 2 (Weeks 3-4)                       │
│  ┌─────────────────┐     ┌─────────────────┐                       │
│  │   Foundation    │────►│  Post & Graph   │                       │
│  │  User Service   │     │    Services     │                       │
│  │  PostgreSQL     │     │     gRPC        │                       │
│  └─────────────────┘     └─────────────────┘                       │
│           │                      │                                  │
│           ▼                      ▼                                  │
│  Phase 3 (Weeks 5-6)     Phase 4 (Weeks 7-8)                       │
│  ┌─────────────────┐     ┌─────────────────┐                       │
│  │     Kafka       │────►│    Timeline     │                       │
│  │  Event Stream   │     │     Redis       │                       │
│  │  Outbox Pattern │     │    Fan-out      │                       │
│  └─────────────────┘     └─────────────────┘                       │
│           │                      │                                  │
│           ▼                      ▼                                  │
│  Phase 5 (Weeks 9-10)    Phase 6 (Weeks 11-12)                     │
│  ┌─────────────────┐     ┌─────────────────┐                       │
│  │  Notifications  │────►│     Search      │                       │
│  │   WebSocket     │     │  Elasticsearch  │                       │
│  │   Real-time     │     │    Trending     │                       │
│  └─────────────────┘     └─────────────────┘                       │
│           │                      │                                  │
│           ▼                      ▼                                  │
│  Phase 7 (Weeks 13-14)   Phase 8 (Weeks 15-16)                     │
│  ┌─────────────────┐     ┌─────────────────┐                       │
│  │   Reliability   │────►│  Observability  │                       │
│  │    Security     │     │   Kubernetes    │                       │
│  │  Rate Limiting  │     │     CI/CD       │                       │
│  └─────────────────┘     └─────────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Milestones

| Week | Milestone | Demo-able Feature |
|------|-----------|-------------------|
| 2 | Phase 1 Complete | User registration, login, profile |
| 4 | Phase 2 Complete | Posts, likes, follows working |
| 6 | Phase 3 Complete | Events flowing through Kafka |
| 8 | Phase 4 Complete | Timeline shows followed users' posts |
| 10 | Phase 5 Complete | Real-time notifications |
| 12 | Phase 6 Complete | Search users and posts |
| 14 | Phase 7 Complete | Production-grade reliability |
| 16 | Phase 8 Complete | Deployed to Kubernetes with monitoring |

## Technology Stack Summary

| Category | Technologies |
|----------|--------------|
| **Framework** | NestJS 10, TypeScript 5 |
| **Databases** | PostgreSQL 16, Elasticsearch 8 |
| **Caching** | Redis 7 |
| **Messaging** | Apache Kafka 3.6 |
| **Communication** | gRPC, REST, WebSocket |
| **Observability** | Prometheus, Grafana, Jaeger |
| **Infrastructure** | Docker, Kubernetes |
| **CI/CD** | GitHub Actions |

---

**Ready to start Phase 1?**

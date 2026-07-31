# Twitter/LinkedIn Distributed Backend System
## Technical Design Document v1.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [High-Level Architecture](#5-high-level-architecture)
6. [Microservices Design](#6-microservices-design)
7. [Database Design](#7-database-design)
8. [API Design](#8-api-design)
9. [Event Streaming Architecture](#9-event-streaming-architecture)
10. [Caching Strategy](#10-caching-strategy)
11. [Security Design](#11-security-design)
12. [Notification System](#12-notification-system)
13. [Deployment Architecture](#13-deployment-architecture)
14. [Failure Modes and Reliability](#14-failure-modes-and-reliability)
15. [Monitoring and Observability](#15-monitoring-and-observability)
16. [Implementation Phases](#16-implementation-phases)

---

## 1. Executive Summary

### 1.1 Project Overview

This document outlines the technical design for a distributed social media backend system inspired by Twitter and LinkedIn. The system handles core social networking features including posts, follows, timelines, notifications, and real-time updates at scale.

### 1.2 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | NestJS | TypeScript, modular architecture, microservices support |
| Inter-service Communication | gRPC | Low latency, type safety, streaming support |
| Event Streaming | Apache Kafka | High throughput, durability, partitioning |
| Caching | Redis Cluster | Sub-millisecond reads, pub/sub, data structures |
| Primary Database | PostgreSQL | ACID compliance, complex queries, reliability |
| Search | Elasticsearch | Full-text search, analytics |
| Container Orchestration | Kubernetes | Auto-scaling, service discovery, resilience |

### 1.3 System Characteristics

- **Expected Scale**: 1M+ users, 10M+ posts, 100M+ follow relationships
- **Timeline Generation**: Hybrid push/pull model
- **Latency Target**: p99 < 200ms for reads, < 500ms for writes
- **Availability Target**: 99.9% uptime

---

## 2. Goals and Non-Goals

### 2.1 Goals

1. **Demonstrate Distributed Systems Expertise**
   - Event-driven architecture with Kafka
   - Microservices communication via gRPC
   - Distributed caching with Redis
   - Horizontal scaling patterns

2. **Showcase Backend Engineering Patterns**
   - Fan-out on write vs fan-out on read
   - Eventually consistent systems
   - Idempotent operations
   - Circuit breaker and retry patterns

3. **Production-Ready Infrastructure**
   - Kubernetes deployment
   - Observability (logs, metrics, traces)
   - Security best practices
   - CI/CD pipeline

4. **Real-World Features**
   - User authentication and authorization
   - Post creation and timeline generation
   - Follow/unfollow with graph traversal
   - Real-time notifications
   - Search functionality

### 2.2 Non-Goals

- Mobile/web frontend development
- Media processing (images, videos) — will use placeholder URLs
- Machine learning recommendations
- Direct messaging (chat)
- Advertising system
- Content moderation AI

---

## 3. Functional Requirements

### 3.1 User Management

| Feature | Description | Priority |
|---------|-------------|----------|
| Registration | Email/password signup with verification | P0 |
| Authentication | JWT-based auth with refresh tokens | P0 |
| Profile Management | Update bio, avatar URL, settings | P1 |
| Account Settings | Privacy controls, notification preferences | P2 |

### 3.2 Post Management

| Feature | Description | Priority |
|---------|-------------|----------|
| Create Post | Text content (280 chars), optional media URLs | P0 |
| Delete Post | Soft delete with cascade to timeline | P0 |
| Like/Unlike | Toggle like with count tracking | P0 |
| Repost | Share post to own followers | P1 |
| Reply | Threaded conversations | P1 |
| Mentions | @username detection and notification | P1 |

### 3.3 Social Graph

| Feature | Description | Priority |
|---------|-------------|----------|
| Follow User | Asymmetric follow relationship | P0 |
| Unfollow User | Remove follow relationship | P0 |
| Get Followers | Paginated list of followers | P0 |
| Get Following | Paginated list of following | P0 |
| Follow Suggestions | Based on mutual connections | P2 |

### 3.4 Timeline

| Feature | Description | Priority |
|---------|-------------|----------|
| Home Timeline | Posts from followed users | P0 |
| User Timeline | Posts by specific user | P0 |
| Timeline Refresh | Pull new posts since last fetch | P1 |
| Infinite Scroll | Cursor-based pagination | P0 |

### 3.5 Notifications

| Feature | Description | Priority |
|---------|-------------|----------|
| New Follower | Alert when someone follows you | P0 |
| Post Liked | Alert when your post is liked | P0 |
| Post Replied | Alert when someone replies | P0 |
| Mention | Alert when mentioned in a post | P0 |
| Mark as Read | Individual and bulk read marking | P1 |

### 3.6 Search

| Feature | Description | Priority |
|---------|-------------|----------|
| Search Users | By username, name | P1 |
| Search Posts | Full-text search in content | P1 |
| Search Hashtags | Trending and historical | P2 |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Read Latency (p50) | < 50ms | API response time |
| Read Latency (p99) | < 200ms | API response time |
| Write Latency (p99) | < 500ms | API response time |
| Timeline Load | < 100ms | First 20 posts |
| Throughput | 10K RPS | Sustained load |

### 4.2 Scalability

| Dimension | Strategy |
|-----------|----------|
| Users | Horizontal scaling of services |
| Posts | Database sharding by user_id |
| Timelines | Redis cluster with partitioning |
| Events | Kafka partitions by user_id |

### 4.3 Availability

| Component | Target | Strategy |
|-----------|--------|----------|
| API Gateway | 99.99% | Multi-replica, load balancing |
| Core Services | 99.9% | Kubernetes auto-restart |
| Database | 99.9% | Primary-replica setup |
| Cache | 99.9% | Redis Sentinel/Cluster |

### 4.4 Data Durability

| Data Type | Durability | Mechanism |
|-----------|------------|-----------|
| User Data | 99.999% | PostgreSQL with WAL |
| Posts | 99.999% | PostgreSQL with backups |
| Timelines | Best effort | Redis with persistence |
| Events | 99.99% | Kafka replication factor 3 |

### 4.5 Security

- All inter-service communication encrypted (mTLS)
- JWT tokens with short expiry (15 min access, 7 day refresh)
- Rate limiting per user and IP
- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- RBAC for admin operations

---

## 5. High-Level Architecture

### 5.1 System Overview

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                        CLIENTS                               │
                                    │              (Web, Mobile, Third-party)                      │
                                    └─────────────────────────┬───────────────────────────────────┘
                                                              │
                                                              ▼
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                    API GATEWAY                               │
                                    │         (Authentication, Rate Limiting, Routing)            │
                                    │                 REST + WebSocket                             │
                                    └─────────────────────────┬───────────────────────────────────┘
                                                              │
                           ┌──────────────────────────────────┼──────────────────────────────────┐
                           │                                  │                                  │
                           ▼                                  ▼                                  ▼
              ┌────────────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
              │     USER SERVICE       │       │     POST SERVICE       │       │   TIMELINE SERVICE     │
              │                        │       │                        │       │                        │
              │  • Registration        │       │  • Create/Delete       │       │  • Home Timeline       │
              │  • Authentication      │       │  • Like/Unlike         │       │  • User Timeline       │
              │  • Profile CRUD        │       │  • Repost/Reply        │       │  • Timeline Fan-out    │
              └───────────┬────────────┘       └───────────┬────────────┘       └───────────┬────────────┘
                          │                                │                                │
                          │ gRPC                           │ gRPC                           │ gRPC
                          │                                │                                │
              ┌───────────┴────────────┐       ┌───────────┴────────────┐       ┌───────────┴────────────┐
              │     GRAPH SERVICE      │       │  NOTIFICATION SERVICE  │       │    SEARCH SERVICE      │
              │                        │       │                        │       │                        │
              │  • Follow/Unfollow     │       │  • Real-time Alerts    │       │  • User Search         │
              │  • Followers List      │       │  • Push Notifications  │       │  • Post Search         │
              │  • Following List      │       │  • Email Notifications │       │  • Hashtag Indexing    │
              └───────────┬────────────┘       └───────────┬────────────┘       └───────────┬────────────┘
                          │                                │                                │
                          └──────────────────────────────────────────────────────────────────┘
                                                          │
                                    ┌─────────────────────┴─────────────────────┐
                                    │                                           │
                                    ▼                                           ▼
                     ┌──────────────────────────┐               ┌──────────────────────────┐
                     │      KAFKA CLUSTER       │               │      REDIS CLUSTER       │
                     │                          │               │                          │
                     │  • post.created          │               │  • Timeline Cache        │
                     │  • post.liked            │               │  • User Cache            │
                     │  • user.followed         │               │  • Session Store         │
                     │  • notification.created  │               │  • Rate Limit Counters   │
                     └──────────────────────────┘               └──────────────────────────┘
                                    │
                                    ▼
                     ┌──────────────────────────┐               ┌──────────────────────────┐
                     │   POSTGRESQL CLUSTER     │               │     ELASTICSEARCH        │
                     │                          │               │                          │
                     │  • Users DB              │               │  • Posts Index           │
                     │  • Posts DB              │               │  • Users Index           │
                     │  • Graph DB              │               │  • Hashtags Index        │
                     │  • Notifications DB      │               │                          │
                     └──────────────────────────┘               └──────────────────────────┘
```

### 5.2 Communication Patterns

| Source | Destination | Protocol | Pattern |
|--------|-------------|----------|---------|
| Client | API Gateway | REST/WebSocket | Request-Response, Push |
| API Gateway | Services | gRPC | Unary, Server Streaming |
| Service | Service | gRPC | Unary calls |
| Service | Kafka | TCP | Async publish |
| Kafka | Service | TCP | Consumer groups |
| Service | Redis | TCP | Cache read/write |
| Service | PostgreSQL | TCP | Queries |

### 5.3 Data Flow Examples

#### 5.3.1 Post Creation Flow

```
1. Client → API Gateway: POST /posts {content: "Hello World"}
2. API Gateway → Post Service (gRPC): CreatePost()
3. Post Service → PostgreSQL: INSERT post
4. Post Service → Kafka: Publish "post.created" event
5. Post Service → API Gateway: Return post object
6. API Gateway → Client: 201 Created

[Async - Timeline Fan-out]
7. Timeline Service ← Kafka: Consume "post.created"
8. Timeline Service → Graph Service (gRPC): GetFollowers(author_id)
9. Timeline Service → Redis: LPUSH to each follower's timeline

[Async - Search Indexing]
10. Search Service ← Kafka: Consume "post.created"
11. Search Service → Elasticsearch: Index post document
```

#### 5.3.2 Timeline Fetch Flow

```
1. Client → API Gateway: GET /timeline?cursor=xxx
2. API Gateway → Timeline Service (gRPC): GetHomeTimeline()
3. Timeline Service → Redis: LRANGE timeline:{user_id}
4. Timeline Service → Post Service (gRPC): GetPostsByIds() [cache miss]
5. Timeline Service → API Gateway: Return posts array
6. API Gateway → Client: 200 OK with posts
```

#### 5.3.3 Follow User Flow

```
1. Client → API Gateway: POST /users/{id}/follow
2. API Gateway → Graph Service (gRPC): FollowUser()
3. Graph Service → PostgreSQL: INSERT follow relationship
4. Graph Service → Kafka: Publish "user.followed" event
5. Graph Service → API Gateway: Return success

[Async - Notification]
6. Notification Service ← Kafka: Consume "user.followed"
7. Notification Service → PostgreSQL: INSERT notification
8. Notification Service → Redis Pub/Sub: Publish real-time alert
9. API Gateway → Client (WebSocket): Push notification
```

---

## 6. Microservices Design

### 6.1 Service Inventory

| Service | Responsibility | Database | Cache |
|---------|---------------|----------|-------|
| API Gateway | Routing, auth, rate limiting | - | Redis |
| User Service | User management, profiles | PostgreSQL | Redis |
| Post Service | Post CRUD, likes | PostgreSQL | Redis |
| Timeline Service | Timeline generation, storage | - | Redis |
| Graph Service | Social relationships | PostgreSQL | Redis |
| Notification Service | Alerts, delivery | PostgreSQL | Redis |
| Search Service | Full-text search | Elasticsearch | - |

### 6.2 Service Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API GATEWAY                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: Nothing (stateless)                                                  │
│  Responsibilities:                                                          │
│    • JWT validation and user context injection                              │
│    • Rate limiting (token bucket per user/IP)                               │
│    • Request routing to internal services                                   │
│    • Response aggregation (BFF pattern)                                     │
│    • WebSocket connection management                                        │
│    • REST to gRPC translation                                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER SERVICE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: users, user_settings, refresh_tokens tables                          │
│  Responsibilities:                                                          │
│    • User registration with email verification                              │
│    • Login/logout with JWT issuance                                         │
│    • Password reset flow                                                    │
│    • Profile management (bio, avatar, settings)                             │
│    • User lookup by ID, username, email                                     │
│  Publishes: user.created, user.updated, user.deleted                        │
│  Consumes: None                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              POST SERVICE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: posts, likes, reposts, replies tables                                │
│  Responsibilities:                                                          │
│    • Post CRUD operations                                                   │
│    • Like/unlike with atomic count updates                                  │
│    • Repost creation                                                        │
│    • Reply threading                                                        │
│    • Mention extraction (@username)                                         │
│    • Hashtag extraction (#topic)                                            │
│  Publishes: post.created, post.deleted, post.liked, post.unliked,           │
│             post.reposted, post.replied, mention.created                    │
│  Consumes: None                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            TIMELINE SERVICE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: Nothing (uses Redis as primary store)                                │
│  Responsibilities:                                                          │
│    • Home timeline generation (fan-out on write)                            │
│    • User timeline retrieval                                                │
│    • Timeline cache management                                              │
│    • Hybrid pull for high-follower accounts                                 │
│  Publishes: None                                                            │
│  Consumes: post.created, post.deleted, user.followed, user.unfollowed       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              GRAPH SERVICE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: follows table                                                        │
│  Responsibilities:                                                          │
│    • Follow/unfollow operations                                             │
│    • Followers/following list retrieval                                     │
│    • Follower count maintenance                                             │
│    • Mutual follow detection                                                │
│    • Follow suggestions (2nd degree connections)                            │
│  Publishes: user.followed, user.unfollowed                                  │
│  Consumes: user.deleted (cascade unfollow)                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                          NOTIFICATION SERVICE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: notifications table                                                  │
│  Responsibilities:                                                          │
│    • Notification creation and storage                                      │
│    • Real-time delivery via Redis Pub/Sub                                   │
│    • Notification preferences enforcement                                   │
│    • Mark as read (individual and bulk)                                     │
│    • Notification aggregation (e.g., "5 people liked your post")            │
│  Publishes: notification.created, notification.delivered                    │
│  Consumes: post.liked, post.replied, user.followed, mention.created         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                             SEARCH SERVICE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Owns: Elasticsearch indices (posts, users, hashtags)                       │
│  Responsibilities:                                                          │
│    • Index posts for full-text search                                       │
│    • Index users for name/username search                                   │
│    • Hashtag tracking and trending calculation                              │
│    • Search query execution                                                 │
│  Publishes: None                                                            │
│  Consumes: post.created, post.deleted, user.created, user.updated           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Inter-Service Dependencies

```
                    ┌──────────────┐
                    │  API Gateway │
                    └──────┬───────┘
                           │
           ┌───────────────┼───────────────┬───────────────┐
           │               │               │               │
           ▼               ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │    User     │ │    Post     │ │  Timeline   │ │   Search    │
    │   Service   │ │   Service   │ │   Service   │ │   Service   │
    └─────────────┘ └──────┬──────┘ └──────┬──────┘ └─────────────┘
                           │               │
                           │               │
                           ▼               ▼
                    ┌─────────────┐ ┌─────────────┐
                    │    Graph    │ │Notification │
                    │   Service   │ │   Service   │
                    └─────────────┘ └─────────────┘

Dependency Rules:
• User Service: No dependencies (foundational)
• Post Service: Calls User Service (author info)
• Graph Service: Calls User Service (validate users exist)
• Timeline Service: Calls Post Service, Graph Service
• Notification Service: Calls User Service (preferences)
• Search Service: No sync dependencies (event-driven only)
```

---

## 7. Database Design

### 7.1 Database per Service

| Service | Database | Schema |
|---------|----------|--------|
| User Service | PostgreSQL | `user_service` |
| Post Service | PostgreSQL | `post_service` |
| Graph Service | PostgreSQL | `graph_service` |
| Notification Service | PostgreSQL | `notification_service` |
| Search Service | Elasticsearch | N/A |

### 7.2 User Service Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                         users                                    │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()     │
│  username        VARCHAR(30) UNIQUE NOT NULL                    │
│  email           VARCHAR(255) UNIQUE NOT NULL                   │
│  password_hash   VARCHAR(255) NOT NULL                          │
│  display_name    VARCHAR(100)                                   │
│  bio             VARCHAR(500)                                   │
│  avatar_url      VARCHAR(500)                                   │
│  is_verified     BOOLEAN DEFAULT FALSE                          │
│  is_active       BOOLEAN DEFAULT TRUE                           │
│  follower_count  INTEGER DEFAULT 0                              │
│  following_count INTEGER DEFAULT 0                              │
│  post_count      INTEGER DEFAULT 0                              │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
│  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_users_username ON username                             │
│    • idx_users_email ON email                                   │
│    • idx_users_created_at ON created_at                         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      user_settings                               │
├─────────────────────────────────────────────────────────────────┤
│  user_id                   UUID PRIMARY KEY REFERENCES users    │
│  email_notifications       BOOLEAN DEFAULT TRUE                 │
│  push_notifications        BOOLEAN DEFAULT TRUE                 │
│  notify_on_follow          BOOLEAN DEFAULT TRUE                 │
│  notify_on_like            BOOLEAN DEFAULT TRUE                 │
│  notify_on_reply           BOOLEAN DEFAULT TRUE                 │
│  notify_on_mention         BOOLEAN DEFAULT TRUE                 │
│  private_account           BOOLEAN DEFAULT FALSE                │
│  updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      refresh_tokens                              │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()     │
│  user_id         UUID NOT NULL REFERENCES users                 │
│  token_hash      VARCHAR(255) NOT NULL                          │
│  device_info     VARCHAR(255)                                   │
│  ip_address      INET                                           │
│  expires_at      TIMESTAMP WITH TIME ZONE NOT NULL              │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_refresh_tokens_user_id ON user_id                      │
│    • idx_refresh_tokens_token_hash ON token_hash                │
│    • idx_refresh_tokens_expires_at ON expires_at                │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Post Service Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                          posts                                   │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()     │
│  author_id       UUID NOT NULL                                  │
│  content         VARCHAR(280) NOT NULL                          │
│  media_urls      TEXT[]                                         │
│  reply_to_id     UUID REFERENCES posts(id)                      │
│  repost_of_id    UUID REFERENCES posts(id)                      │
│  like_count      INTEGER DEFAULT 0                              │
│  reply_count     INTEGER DEFAULT 0                              │
│  repost_count    INTEGER DEFAULT 0                              │
│  is_deleted      BOOLEAN DEFAULT FALSE                          │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
│  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_posts_author_id ON author_id                           │
│    • idx_posts_created_at ON created_at DESC                    │
│    • idx_posts_reply_to_id ON reply_to_id WHERE reply_to_id IS NOT NULL │
│    • idx_posts_author_created ON (author_id, created_at DESC)   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                          likes                                   │
├─────────────────────────────────────────────────────────────────┤
│  user_id         UUID NOT NULL                                  │
│  post_id         UUID NOT NULL REFERENCES posts(id)             │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
│  PRIMARY KEY (user_id, post_id)                                 │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_likes_post_id ON post_id                               │
│    • idx_likes_user_id ON user_id                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        hashtags                                  │
├─────────────────────────────────────────────────────────────────┤
│  id              SERIAL PRIMARY KEY                             │
│  tag             VARCHAR(100) UNIQUE NOT NULL                   │
│  post_count      INTEGER DEFAULT 0                              │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_hashtags_tag ON tag                                    │
│    • idx_hashtags_post_count ON post_count DESC                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      post_hashtags                               │
├─────────────────────────────────────────────────────────────────┤
│  post_id         UUID NOT NULL REFERENCES posts(id)             │
│  hashtag_id      INTEGER NOT NULL REFERENCES hashtags(id)       │
│  PRIMARY KEY (post_id, hashtag_id)                              │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_post_hashtags_hashtag_id ON hashtag_id                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        mentions                                  │
├─────────────────────────────────────────────────────────────────┤
│  post_id         UUID NOT NULL REFERENCES posts(id)             │
│  mentioned_user_id UUID NOT NULL                                │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
│  PRIMARY KEY (post_id, mentioned_user_id)                       │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_mentions_mentioned_user_id ON mentioned_user_id        │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Graph Service Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                         follows                                  │
├─────────────────────────────────────────────────────────────────┤
│  follower_id     UUID NOT NULL                                  │
│  following_id    UUID NOT NULL                                  │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
│  PRIMARY KEY (follower_id, following_id)                        │
├─────────────────────────────────────────────────────────────────┤
│  CONSTRAINTS:                                                   │
│    • CHECK (follower_id != following_id)                        │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_follows_follower_id ON follower_id                     │
│    • idx_follows_following_id ON following_id                   │
│    • idx_follows_created_at ON created_at DESC                  │
└─────────────────────────────────────────────────────────────────┘

Note: Follower/following counts are denormalized in the users table
      and updated via Kafka events for performance.
```

### 7.5 Notification Service Schema

```
┌─────────────────────────────────────────────────────────────────┐
│                      notifications                               │
├─────────────────────────────────────────────────────────────────┤
│  id              UUID PRIMARY KEY DEFAULT gen_random_uuid()     │
│  user_id         UUID NOT NULL                                  │
│  type            VARCHAR(50) NOT NULL                           │
│  actor_id        UUID NOT NULL                                  │
│  entity_type     VARCHAR(50)                                    │
│  entity_id       UUID                                           │
│  message         VARCHAR(500)                                   │
│  is_read         BOOLEAN DEFAULT FALSE                          │
│  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()         │
├─────────────────────────────────────────────────────────────────┤
│  TYPES: 'follow', 'like', 'reply', 'mention', 'repost'          │
│  ENTITY_TYPE: 'post', 'user'                                    │
├─────────────────────────────────────────────────────────────────┤
│  INDEXES:                                                       │
│    • idx_notifications_user_id ON user_id                       │
│    • idx_notifications_user_read ON (user_id, is_read)          │
│    • idx_notifications_created_at ON created_at DESC            │
│    • idx_notifications_user_created ON (user_id, created_at DESC)│
└─────────────────────────────────────────────────────────────────┘
```

### 7.6 Elasticsearch Indices

```json
// Posts Index
{
  "index": "posts",
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "author_id": { "type": "keyword" },
      "author_username": { "type": "keyword" },
      "author_display_name": { "type": "text" },
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

// Users Index
{
  "index": "users",
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "username": { 
        "type": "text",
        "fields": {
          "keyword": { "type": "keyword" }
        }
      },
      "display_name": { "type": "text" },
      "bio": { "type": "text" },
      "follower_count": { "type": "integer" },
      "is_verified": { "type": "boolean" },
      "created_at": { "type": "date" }
    }
  }
}

// Hashtags Index (for trending)
{
  "index": "hashtags",
  "mappings": {
    "properties": {
      "tag": { "type": "keyword" },
      "post_count": { "type": "integer" },
      "recent_count": { "type": "integer" },
      "last_used": { "type": "date" }
    }
  }
}
```

---

## 8. API Design

### 8.1 REST API (Client-Facing)

#### 8.1.1 Authentication

```
POST   /api/v1/auth/register        Create new account
POST   /api/v1/auth/login           Login and receive tokens
POST   /api/v1/auth/logout          Invalidate refresh token
POST   /api/v1/auth/refresh         Get new access token
POST   /api/v1/auth/forgot-password Request password reset
POST   /api/v1/auth/reset-password  Complete password reset
```

#### 8.1.2 Users

```
GET    /api/v1/users/me             Get current user profile
PATCH  /api/v1/users/me             Update current user profile
GET    /api/v1/users/:username      Get user by username
GET    /api/v1/users/:id/followers  Get user's followers (paginated)
GET    /api/v1/users/:id/following  Get user's following (paginated)
POST   /api/v1/users/:id/follow     Follow a user
DELETE /api/v1/users/:id/follow     Unfollow a user
```

#### 8.1.3 Posts

```
POST   /api/v1/posts                Create a new post
GET    /api/v1/posts/:id            Get post by ID
DELETE /api/v1/posts/:id            Delete post (soft delete)
POST   /api/v1/posts/:id/like       Like a post
DELETE /api/v1/posts/:id/like       Unlike a post
POST   /api/v1/posts/:id/repost     Repost a post
GET    /api/v1/posts/:id/replies    Get replies to a post
POST   /api/v1/posts/:id/replies    Reply to a post
```

#### 8.1.4 Timeline

```
GET    /api/v1/timeline/home        Get home timeline (paginated)
GET    /api/v1/timeline/user/:id    Get user's posts (paginated)
```

#### 8.1.5 Notifications

```
GET    /api/v1/notifications        Get notifications (paginated)
POST   /api/v1/notifications/read   Mark notifications as read
GET    /api/v1/notifications/unread-count  Get unread count
```

#### 8.1.6 Search

```
GET    /api/v1/search/users?q=      Search users
GET    /api/v1/search/posts?q=      Search posts
GET    /api/v1/search/hashtags?q=   Search hashtags
GET    /api/v1/trending/hashtags    Get trending hashtags
```

### 8.2 gRPC API (Inter-Service)

#### 8.2.1 User Service Proto

```protobuf
syntax = "proto3";
package user;

service UserService {
  // User CRUD
  rpc GetUser(GetUserRequest) returns (User);
  rpc GetUserByUsername(GetUserByUsernameRequest) returns (User);
  rpc GetUsersByIds(GetUsersByIdsRequest) returns (GetUsersByIdsResponse);
  rpc CreateUser(CreateUserRequest) returns (User);
  rpc UpdateUser(UpdateUserRequest) returns (User);
  
  // Authentication
  rpc ValidateCredentials(ValidateCredentialsRequest) returns (ValidateCredentialsResponse);
  rpc GetUserSettings(GetUserSettingsRequest) returns (UserSettings);
  
  // Counters (called by other services)
  rpc IncrementFollowerCount(CounterRequest) returns (CounterResponse);
  rpc DecrementFollowerCount(CounterRequest) returns (CounterResponse);
  rpc IncrementPostCount(CounterRequest) returns (CounterResponse);
}

message User {
  string id = 1;
  string username = 2;
  string email = 3;
  string display_name = 4;
  string bio = 5;
  string avatar_url = 6;
  bool is_verified = 7;
  int32 follower_count = 8;
  int32 following_count = 9;
  int32 post_count = 10;
  google.protobuf.Timestamp created_at = 11;
}

message GetUserRequest {
  string user_id = 1;
}

message GetUsersByIdsRequest {
  repeated string user_ids = 1;
}

message GetUsersByIdsResponse {
  repeated User users = 1;
}

message UserSettings {
  string user_id = 1;
  bool notify_on_follow = 2;
  bool notify_on_like = 3;
  bool notify_on_reply = 4;
  bool notify_on_mention = 5;
}
```

#### 8.2.2 Post Service Proto

```protobuf
syntax = "proto3";
package post;

service PostService {
  // Post CRUD
  rpc CreatePost(CreatePostRequest) returns (Post);
  rpc GetPost(GetPostRequest) returns (Post);
  rpc GetPostsByIds(GetPostsByIdsRequest) returns (GetPostsByIdsResponse);
  rpc GetPostsByAuthor(GetPostsByAuthorRequest) returns (PostList);
  rpc DeletePost(DeletePostRequest) returns (DeletePostResponse);
  
  // Interactions
  rpc LikePost(LikePostRequest) returns (LikePostResponse);
  rpc UnlikePost(UnlikePostRequest) returns (UnlikePostResponse);
  rpc GetReplies(GetRepliesRequest) returns (PostList);
  
  // Batch operations (for timeline)
  rpc GetPostsForTimeline(GetPostsForTimelineRequest) returns (stream Post);
}

message Post {
  string id = 1;
  string author_id = 2;
  string content = 3;
  repeated string media_urls = 4;
  optional string reply_to_id = 5;
  optional string repost_of_id = 6;
  int32 like_count = 7;
  int32 reply_count = 8;
  int32 repost_count = 9;
  google.protobuf.Timestamp created_at = 10;
  
  // Enriched fields (populated by gateway)
  optional User author = 11;
  optional Post original_post = 12;
}

message CreatePostRequest {
  string author_id = 1;
  string content = 2;
  repeated string media_urls = 3;
  optional string reply_to_id = 4;
}

message GetPostsByIdsRequest {
  repeated string post_ids = 1;
}

message GetPostsByIdsResponse {
  repeated Post posts = 1;
}

message PostList {
  repeated Post posts = 1;
  string next_cursor = 2;
  bool has_more = 3;
}
```

#### 8.2.3 Graph Service Proto

```protobuf
syntax = "proto3";
package graph;

service GraphService {
  // Follow operations
  rpc FollowUser(FollowUserRequest) returns (FollowUserResponse);
  rpc UnfollowUser(UnfollowUserRequest) returns (UnfollowUserResponse);
  rpc IsFollowing(IsFollowingRequest) returns (IsFollowingResponse);
  
  // List operations
  rpc GetFollowers(GetFollowersRequest) returns (FollowList);
  rpc GetFollowing(GetFollowingRequest) returns (FollowList);
  rpc GetFollowerIds(GetFollowerIdsRequest) returns (GetFollowerIdsResponse);
  
  // Batch operations
  rpc GetFollowingIds(GetFollowingIdsRequest) returns (GetFollowingIdsResponse);
  rpc GetMutualFollowers(GetMutualFollowersRequest) returns (GetMutualFollowersResponse);
}

message FollowUserRequest {
  string follower_id = 1;
  string following_id = 2;
}

message FollowUserResponse {
  bool success = 1;
  bool already_following = 2;
}

message GetFollowerIdsRequest {
  string user_id = 1;
  int32 limit = 2;      // For fan-out batching
  int32 offset = 3;
}

message GetFollowerIdsResponse {
  repeated string follower_ids = 1;
  bool has_more = 2;
}

message FollowList {
  repeated FollowRelation follows = 1;
  string next_cursor = 2;
  bool has_more = 3;
}

message FollowRelation {
  string user_id = 1;
  google.protobuf.Timestamp followed_at = 2;
}
```

#### 8.2.4 Timeline Service Proto

```protobuf
syntax = "proto3";
package timeline;

service TimelineService {
  // Timeline retrieval
  rpc GetHomeTimeline(GetHomeTimelineRequest) returns (TimelineResponse);
  rpc GetUserTimeline(GetUserTimelineRequest) returns (TimelineResponse);
  
  // Timeline management (internal)
  rpc FanOutPost(FanOutPostRequest) returns (FanOutPostResponse);
  rpc RemovePost(RemovePostRequest) returns (RemovePostResponse);
  
  // Streaming for real-time updates
  rpc StreamTimeline(StreamTimelineRequest) returns (stream TimelineUpdate);
}

message GetHomeTimelineRequest {
  string user_id = 1;
  string cursor = 2;      // post_id for keyset pagination
  int32 limit = 3;        // default 20, max 100
}

message TimelineResponse {
  repeated TimelineEntry entries = 1;
  string next_cursor = 2;
  bool has_more = 3;
}

message TimelineEntry {
  string post_id = 1;
  double score = 2;       // timestamp as score for sorting
}

message FanOutPostRequest {
  string post_id = 1;
  string author_id = 2;
  google.protobuf.Timestamp created_at = 3;
}

message StreamTimelineRequest {
  string user_id = 1;
}

message TimelineUpdate {
  string post_id = 1;
  string action = 2;      // 'add' or 'remove'
}
```

#### 8.2.5 Notification Service Proto

```protobuf
syntax = "proto3";
package notification;

service NotificationService {
  // Notification CRUD
  rpc CreateNotification(CreateNotificationRequest) returns (Notification);
  rpc GetNotifications(GetNotificationsRequest) returns (NotificationList);
  rpc MarkAsRead(MarkAsReadRequest) returns (MarkAsReadResponse);
  rpc GetUnreadCount(GetUnreadCountRequest) returns (GetUnreadCountResponse);
  
  // Real-time streaming
  rpc StreamNotifications(StreamNotificationsRequest) returns (stream Notification);
}

message Notification {
  string id = 1;
  string user_id = 2;
  string type = 3;           // 'follow', 'like', 'reply', 'mention'
  string actor_id = 4;
  string entity_type = 5;    // 'post', 'user'
  string entity_id = 6;
  string message = 7;
  bool is_read = 8;
  google.protobuf.Timestamp created_at = 9;
  
  // Enriched
  optional User actor = 10;
}

message CreateNotificationRequest {
  string user_id = 1;
  string type = 2;
  string actor_id = 3;
  string entity_type = 4;
  string entity_id = 5;
}

message NotificationList {
  repeated Notification notifications = 1;
  string next_cursor = 2;
  bool has_more = 3;
  int32 unread_count = 4;
}
```

#### 8.2.6 Search Service Proto

```protobuf
syntax = "proto3";
package search;

service SearchService {
  // Search operations
  rpc SearchUsers(SearchUsersRequest) returns (SearchUsersResponse);
  rpc SearchPosts(SearchPostsRequest) returns (SearchPostsResponse);
  rpc SearchHashtags(SearchHashtagsRequest) returns (SearchHashtagsResponse);
  rpc GetTrendingHashtags(GetTrendingHashtagsRequest) returns (GetTrendingHashtagsResponse);
  
  // Indexing (internal)
  rpc IndexPost(IndexPostRequest) returns (IndexResponse);
  rpc IndexUser(IndexUserRequest) returns (IndexResponse);
  rpc DeletePostIndex(DeletePostIndexRequest) returns (IndexResponse);
}

message SearchUsersRequest {
  string query = 1;
  int32 limit = 2;
  int32 offset = 3;
}

message SearchUsersResponse {
  repeated UserSearchResult users = 1;
  int32 total = 2;
}

message UserSearchResult {
  string id = 1;
  string username = 2;
  string display_name = 3;
  string avatar_url = 4;
  bool is_verified = 5;
  int32 follower_count = 6;
  float score = 7;
}

message SearchPostsRequest {
  string query = 1;
  optional string author_id = 2;
  optional string hashtag = 3;
  int32 limit = 4;
  int32 offset = 5;
  string sort_by = 6;     // 'relevance', 'recent', 'popular'
}

message GetTrendingHashtagsRequest {
  int32 limit = 1;        // default 10
  string time_window = 2; // '1h', '24h', '7d'
}

message GetTrendingHashtagsResponse {
  repeated TrendingHashtag hashtags = 1;
}

message TrendingHashtag {
  string tag = 1;
  int32 post_count = 2;
  int32 change_percent = 3;  // vs previous period
}
```

---

## 9. Event Streaming Architecture

### 9.1 Kafka Topics

| Topic | Partitions | Retention | Producers | Consumers |
|-------|------------|-----------|-----------|-----------|
| `user.events` | 10 | 7 days | User Service | Search, Graph |
| `post.events` | 20 | 7 days | Post Service | Timeline, Search, Notification |
| `graph.events` | 10 | 7 days | Graph Service | Timeline, Notification, User |
| `notification.events` | 10 | 3 days | Notification Service | Analytics |

### 9.2 Event Schemas

```json
// user.events
{
  "event_id": "uuid",
  "event_type": "user.created | user.updated | user.deleted",
  "timestamp": "ISO8601",
  "data": {
    "user_id": "uuid",
    "username": "string",
    "display_name": "string",
    // ... relevant fields for the event
  }
}

// post.events
{
  "event_id": "uuid",
  "event_type": "post.created | post.deleted | post.liked | post.unliked | post.reposted | post.replied",
  "timestamp": "ISO8601",
  "data": {
    "post_id": "uuid",
    "author_id": "uuid",
    "content": "string (for created)",
    "target_user_id": "uuid (for liked/replied - post owner)",
    "actor_id": "uuid (for liked - who liked)"
  }
}

// graph.events
{
  "event_id": "uuid",
  "event_type": "user.followed | user.unfollowed",
  "timestamp": "ISO8601",
  "data": {
    "follower_id": "uuid",
    "following_id": "uuid"
  }
}
```

### 9.3 Partition Strategy

```
Topic: post.events
Partition Key: author_id

Rationale:
- All posts by the same author go to same partition
- Maintains ordering for user's post sequence
- Timeline fan-out can process author's posts in order

Topic: graph.events
Partition Key: following_id

Rationale:
- All follow events for a user go to same partition
- Notification service processes in order per user
- Prevents race conditions in follower count updates

Topic: user.events
Partition Key: user_id

Rationale:
- All events for a user go to same partition
- Search indexing maintains consistency
```

### 9.4 Consumer Groups

| Consumer Group | Topic | Service | Concurrency |
|----------------|-------|---------|-------------|
| `timeline-fanout` | post.events | Timeline Service | 10 |
| `search-indexer` | post.events, user.events | Search Service | 5 |
| `notification-processor` | post.events, graph.events | Notification Service | 10 |
| `user-counter-sync` | graph.events | User Service | 5 |

### 9.5 Event Processing Flow

```
                                Post Service
                                     │
                                     │ Publish
                                     ▼
                            ┌────────────────┐
                            │  post.events   │
                            │     Topic      │
                            └────────┬───────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           │                         │                         │
           ▼                         ▼                         ▼
   ┌───────────────┐        ┌───────────────┐        ┌───────────────┐
   │   Timeline    │        │    Search     │        │ Notification  │
   │   Service     │        │    Service    │        │   Service     │
   │               │        │               │        │               │
   │ Consumer:     │        │ Consumer:     │        │ Consumer:     │
   │ timeline-     │        │ search-       │        │ notification- │
   │ fanout        │        │ indexer       │        │ processor     │
   └───────┬───────┘        └───────┬───────┘        └───────┬───────┘
           │                         │                         │
           ▼                         ▼                         ▼
      Redis Cache             Elasticsearch              PostgreSQL
    (User Timelines)           (Posts Index)           (Notifications)
```

### 9.6 Exactly-Once Semantics

```
Strategy: Idempotent Consumers + Transactional Outbox

1. Producer Side (Post Service):
   - Write to posts table
   - Write to outbox table (same transaction)
   - Background worker publishes from outbox
   - Delete from outbox after ACK

2. Consumer Side (Timeline Service):
   - Store last processed event_id per partition
   - Check if event_id already processed (dedup table)
   - Process event
   - Update processed offset
   - Commit Kafka offset
```

---

## 10. Caching Strategy

### 10.1 Redis Data Structures

| Key Pattern | Data Structure | TTL | Purpose |
|-------------|----------------|-----|---------|
| `user:{id}` | Hash | 1 hour | User profile cache |
| `user:username:{name}` | String | 1 hour | Username to ID mapping |
| `post:{id}` | Hash | 30 min | Post data cache |
| `timeline:{user_id}` | Sorted Set | No TTL | Home timeline (post IDs) |
| `user_timeline:{user_id}` | Sorted Set | 1 hour | User's own posts |
| `followers:{user_id}` | Set | 15 min | Follower IDs (for small accounts) |
| `session:{token}` | String | 15 min | Session validation |
| `rate_limit:{user_id}:{endpoint}` | String | 1 min | Rate limit counter |
| `notifications:unread:{user_id}` | String | No TTL | Unread notification count |

### 10.2 Cache Patterns

#### 10.2.1 Cache-Aside (User/Post Data)

```
Read:
1. Check Redis cache
2. If miss → Query PostgreSQL
3. Write to Redis with TTL
4. Return data

Write:
1. Update PostgreSQL
2. Invalidate Redis cache (don't update)
3. Let next read repopulate
```

#### 10.2.2 Write-Through (Timeline)

```
Post Created:
1. Write post to PostgreSQL
2. Publish event to Kafka
3. Timeline Service consumes event
4. Write to Redis sorted set directly
   ZADD timeline:{follower_id} {timestamp} {post_id}
```

#### 10.2.3 Read-Through (Hot Posts)

```
For viral posts (>10K likes):
1. Check cache
2. If miss → Load from DB
3. Cache with longer TTL (1 hour)
4. Refresh TTL on each access
```

### 10.3 Timeline Cache Design

```
Key: timeline:{user_id}
Type: Sorted Set
Score: Unix timestamp (ms)
Member: post_id

Operations:
- Add post:     ZADD timeline:{user_id} {timestamp} {post_id}
- Remove post:  ZREM timeline:{user_id} {post_id}
- Get timeline: ZREVRANGEBYSCORE timeline:{user_id} +inf {cursor} LIMIT 0 20
- Trim old:     ZREMRANGEBYRANK timeline:{user_id} 0 -{max_size}

Max Timeline Size: 1000 posts (older posts fetched from DB)
```

### 10.4 Cache Invalidation Events

| Event | Cache Keys Invalidated |
|-------|----------------------|
| user.updated | `user:{id}`, `user:username:{old}`, `user:username:{new}` |
| post.deleted | `post:{id}`, remove from all timelines |
| post.liked | `post:{id}` (like_count changed) |
| user.followed | `followers:{id}` (if cached) |

### 10.5 Redis Cluster Configuration

```
Nodes: 6 (3 masters, 3 replicas)
Slots: 16384 distributed across masters

Sharding Strategy:
- Hash tag for related keys
- timeline:{user_id} and user:{user_id} on same node
- Use {user_id} as hash tag: timeline:{user_id}, user:{user_id}
```

---

## 11. Security Design

### 11.1 Authentication Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Client  │────►│  API Gateway │────►│ User Service │
└──────────┘     └──────────────┘     └──────────────┘
     │                  │                    │
     │ 1. Login         │                    │
     │ (email, pass)    │                    │
     │─────────────────►│                    │
     │                  │ 2. Validate        │
     │                  │ credentials (gRPC) │
     │                  │───────────────────►│
     │                  │                    │
     │                  │ 3. User data       │
     │                  │◄───────────────────│
     │                  │                    │
     │                  │ 4. Generate        │
     │                  │    JWT tokens      │
     │ 5. Access +      │                    │
     │    Refresh token │                    │
     │◄─────────────────│                    │
```

### 11.2 JWT Token Structure

```json
// Access Token (15 min expiry)
{
  "sub": "user_uuid",
  "username": "johndoe",
  "type": "access",
  "iat": 1234567890,
  "exp": 1234568790
}

// Refresh Token (7 day expiry)
{
  "sub": "user_uuid",
  "type": "refresh",
  "jti": "unique_token_id",
  "iat": 1234567890,
  "exp": 1235172690
}
```

### 11.3 Rate Limiting

| Endpoint Category | Limit | Window | Key |
|-------------------|-------|--------|-----|
| Authentication | 5 | 1 min | IP |
| Post Creation | 30 | 1 hour | User ID |
| Follow/Unfollow | 100 | 1 day | User ID |
| Timeline Fetch | 100 | 1 min | User ID |
| Search | 30 | 1 min | User ID |
| General API | 1000 | 1 hour | User ID |

### 11.4 Rate Limiting Implementation

```
Algorithm: Token Bucket (via Redis)

Key: rate_limit:{user_id}:{endpoint_category}
Structure: Hash
  - tokens: current token count
  - last_refill: timestamp of last refill

Process:
1. GET tokens and last_refill
2. Calculate tokens to add (time elapsed * rate)
3. If tokens >= 1, decrement and allow
4. If tokens < 1, reject with 429 and Retry-After header
```

### 11.5 Input Validation

```typescript
// Post content validation
- Max length: 280 characters
- Sanitize HTML entities
- Validate URLs in media_urls array
- Rate limit mentions: max 10 per post
- Rate limit hashtags: max 10 per post

// User input validation
- Username: ^[a-zA-Z0-9_]{3,30}$
- Email: RFC 5322 compliant
- Password: min 8 chars, complexity requirements
- Bio: max 500 chars, sanitize HTML
- URLs: validate format, whitelist protocols (http, https)
```

### 11.6 Inter-Service Security

```
mTLS Configuration:
- Each service has its own certificate
- Certificates signed by internal CA
- Certificate rotation: 90 days
- gRPC channels configured with SSL credentials

Service Authentication:
- Services include service identity in gRPC metadata
- Receiving service validates identity
- RBAC for service-to-service calls
```

---

## 12. Notification System

### 12.1 Notification Types

| Type | Trigger Event | Template |
|------|---------------|----------|
| `follow` | user.followed | "{actor} started following you" |
| `like` | post.liked | "{actor} liked your post" |
| `reply` | post.replied | "{actor} replied to your post" |
| `mention` | mention.created | "{actor} mentioned you in a post" |
| `repost` | post.reposted | "{actor} reposted your post" |

### 12.2 Notification Aggregation

```
Scenario: 50 people like your post in 1 hour

Without Aggregation:
- 50 separate notifications
- Noisy, poor UX

With Aggregation:
- "John and 49 others liked your post"
- Single notification, updates count

Implementation:
- Group by (user_id, type, entity_id, time_window)
- Keep list of actor_ids in Redis
- Display latest 3 actors + count
```

### 12.3 Real-Time Delivery

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Notification   │────►│   Redis Pub/Sub  │────►│   API Gateway    │
│     Service      │     │                  │     │   (WebSocket)    │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                                          │
                                                          │ Push
                                                          ▼
                                                  ┌──────────────────┐
                                                  │      Client      │
                                                  └──────────────────┘

Channel: notifications:{user_id}

Flow:
1. Notification Service creates notification
2. Publishes to Redis channel: notifications:{user_id}
3. API Gateway subscribes to channels for connected users
4. Gateway pushes to client via WebSocket
```

### 12.4 Notification Preferences

```
user_settings table:
- notify_on_follow: boolean
- notify_on_like: boolean
- notify_on_reply: boolean
- notify_on_mention: boolean

Enforcement:
1. Notification Service receives event
2. Fetch user settings (cached)
3. Check if notification type is enabled
4. If disabled, skip creation
5. If enabled, create and deliver
```

---

## 13. Deployment Architecture

### 13.1 Kubernetes Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Kubernetes Cluster                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Ingress Controller                           │   │
│  │                     (nginx-ingress / traefik)                        │   │
│  └─────────────────────────────────────────┬───────────────────────────┘   │
│                                            │                               │
│  ┌─────────────────────────────────────────┴───────────────────────────┐   │
│  │                          API Gateway                                 │   │
│  │                     Deployment (3 replicas)                          │   │
│  │                    Service (ClusterIP + HPA)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │    User      │ │    Post      │ │   Timeline   │ │    Graph     │       │
│  │   Service    │ │   Service    │ │   Service    │ │   Service    │       │
│  │  (2 replicas)│ │  (3 replicas)│ │  (3 replicas)│ │  (2 replicas)│       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│                                                                             │
│  ┌──────────────┐ ┌──────────────┐                                         │
│  │ Notification │ │    Search    │                                         │
│  │   Service    │ │   Service    │                                         │
│  │  (2 replicas)│ │  (2 replicas)│                                         │
│  └──────────────┘ └──────────────┘                                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        StatefulSets                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │   │
│  │  │   Kafka     │  │    Redis    │  │ Elasticsearch│                  │   │
│  │  │  (3 nodes)  │  │  (6 nodes)  │  │  (3 nodes)  │                  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                   PostgreSQL (External/CloudSQL)                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Service Configuration

```yaml
# Example: Post Service Deployment
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
    metadata:
      labels:
        app: post-service
    spec:
      containers:
      - name: post-service
        image: social-app/post-service:latest
        ports:
        - containerPort: 50051  # gRPC
        - containerPort: 8080   # Health checks
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-secrets
              key: post-service-url
        - name: KAFKA_BROKERS
          value: "kafka-0.kafka:9092,kafka-1.kafka:9092,kafka-2.kafka:9092"
        - name: REDIS_URL
          value: "redis://redis-cluster:6379"
        livenessProbe:
          grpc:
            port: 50051
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          grpc:
            port: 50051
          initialDelaySeconds: 5
          periodSeconds: 5
```

### 13.3 Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: post-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: post-service
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

### 13.4 Namespace Organization

```
Namespaces:
├── social-app          # Application services
├── social-app-data     # Stateful services (Kafka, Redis, ES)
├── monitoring          # Prometheus, Grafana, Jaeger
├── ingress             # Ingress controller
└── cert-manager        # TLS certificate management
```

---

## 14. Failure Modes and Reliability

### 14.1 Failure Scenarios and Mitigations

| Failure | Impact | Detection | Mitigation |
|---------|--------|-----------|------------|
| User Service down | Login/register fails | Health checks | Retry + cached user data |
| Post Service down | Post creation fails | Health checks | Queue writes for replay |
| Redis down | Slow timeline reads | Health checks | Fallback to DB |
| Kafka down | Events not processed | Broker health | Transactional outbox retry |
| PostgreSQL down | Full outage | Connection pool | Failover to replica |
| Network partition | Partial functionality | Distributed health | Circuit breakers |

### 14.2 Circuit Breaker Configuration

```typescript
Circuit Breaker Settings per Service:

{
  "failureThreshold": 5,        // Failures before opening
  "successThreshold": 3,        // Successes to close
  "timeout": 30000,             // Time in open state (ms)
  "volumeThreshold": 10,        // Min requests for stats
  "errorPercentageThreshold": 50
}

States:
- CLOSED: Normal operation, requests pass through
- OPEN: All requests fail fast (no backend calls)
- HALF_OPEN: Limited requests to test recovery
```

### 14.3 Retry Strategy

```typescript
Retry Configuration:

{
  "maxRetries": 3,
  "initialDelay": 100,          // ms
  "maxDelay": 5000,             // ms
  "multiplier": 2,              // exponential backoff
  "jitter": 0.1,                // 10% random jitter
  "retryableErrors": [
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "RESOURCE_EXHAUSTED"
  ]
}
```

### 14.4 Graceful Degradation

```
Scenario: Redis cluster is down

Degradation Strategy:
1. Timeline Service detects Redis failure
2. Circuit breaker opens for Redis calls
3. Fall back to PostgreSQL for timeline:
   - Query posts table with author_id IN (following_ids)
   - Slower but functional
4. Return stale data if available in local cache
5. Set header: X-Degraded-Mode: true
6. Monitor for Redis recovery
7. Circuit breaker closes, normal operation resumes
```

### 14.5 Idempotency Implementation

```
Idempotency Key Storage:

Table: idempotency_keys
- key: VARCHAR(255) PRIMARY KEY
- request_hash: VARCHAR(64)
- response: JSONB
- created_at: TIMESTAMP
- expires_at: TIMESTAMP

Flow:
1. Client includes Idempotency-Key header
2. Gateway checks if key exists
3. If exists and request matches → return cached response
4. If exists and request differs → return 409 Conflict
5. If not exists → process request, store response
6. Return response with X-Idempotent-Replayed header if replayed
```

### 14.6 Dead Letter Queue Processing

```
DLQ Structure:

Topic: {original-topic}.dlq

Message Schema:
{
  "original_message": { ... },
  "error": "Exception message",
  "stack_trace": "...",
  "retry_count": 3,
  "first_failure": "ISO8601",
  "last_failure": "ISO8601",
  "original_topic": "post.events",
  "original_partition": 5
}

Processing:
1. DLQ consumer reads messages
2. Categorize by error type:
   - Transient: Schedule retry with backoff
   - Permanent: Alert + manual review
   - Data issue: Route to repair queue
3. Track metrics: DLQ depth, processing rate
4. Alert if DLQ grows beyond threshold
```

---

## 15. Monitoring and Observability

### 15.1 Three Pillars

```
┌─────────────────────────────────────────────────────────────────┐
│                      OBSERVABILITY                               │
├─────────────────────┬─────────────────────┬─────────────────────┤
│       LOGS          │       METRICS       │       TRACES        │
├─────────────────────┼─────────────────────┼─────────────────────┤
│  • Structured JSON  │  • Prometheus       │  • OpenTelemetry    │
│  • Correlation IDs  │  • Custom metrics   │  • Jaeger           │
│  • Log levels       │  • Dashboards       │  • Span propagation │
│  • ELK Stack        │  • Grafana          │  • Service maps     │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

### 15.2 Key Metrics

| Category | Metric | Alert Threshold |
|----------|--------|-----------------|
| **Latency** | p99 response time | > 500ms |
| **Traffic** | Requests per second | > 10K RPS |
| **Errors** | 5xx rate | > 1% |
| **Saturation** | CPU utilization | > 80% |
| **Saturation** | Memory utilization | > 85% |
| **Database** | Connection pool usage | > 80% |
| **Kafka** | Consumer lag | > 10K messages |
| **Redis** | Hit rate | < 90% |
| **Redis** | Memory usage | > 80% |

### 15.3 Custom Application Metrics

```typescript
// Post Service Metrics
post_created_total             Counter    Total posts created
post_deleted_total             Counter    Total posts deleted
post_like_total                Counter    Total likes
post_creation_duration_seconds Histogram  Post creation latency

// Timeline Service Metrics
timeline_fanout_total          Counter    Fan-out operations
timeline_fanout_duration       Histogram  Fan-out latency
timeline_cache_hit_total       Counter    Cache hits
timeline_cache_miss_total      Counter    Cache misses

// Graph Service Metrics
follow_created_total           Counter    New follows
follow_deleted_total           Counter    Unfollows
followers_query_duration       Histogram  Query latency

// Notification Service Metrics
notification_created_total     Counter    Notifications created
notification_delivered_total   Counter    Real-time deliveries
notification_delivery_latency  Histogram  Delivery time
```

### 15.4 Distributed Tracing

```
Trace Context Propagation:

Headers:
- traceparent: 00-{trace-id}-{span-id}-{flags}
- tracestate: vendor-specific data

Flow:
1. API Gateway generates trace ID
2. Injects into gRPC metadata
3. Each service extracts and creates child spans
4. Spans include:
   - Service name
   - Operation name
   - Duration
   - Status
   - Tags (user_id, post_id, etc.)
   - Logs (events within span)
```

### 15.5 Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
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

### 15.6 Alerting Rules

```yaml
# Prometheus Alert Rules
groups:
- name: social-app-alerts
  rules:
  - alert: HighErrorRate
    expr: |
      sum(rate(http_requests_total{status=~"5.."}[5m])) /
      sum(rate(http_requests_total[5m])) > 0.01
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      
  - alert: KafkaConsumerLag
    expr: kafka_consumer_lag > 10000
    for: 10m
    labels:
      severity: warning
    annotations:
      summary: "Kafka consumer lag is high"
      
  - alert: RedisHighMemory
    expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "Redis memory usage above 80%"
```

---

## 16. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goals:**
- Project structure and tooling
- Basic User Service with authentication
- PostgreSQL setup with migrations
- Docker Compose for local development

**Deliverables:**
- [ ] NestJS monorepo setup
- [ ] User registration and login
- [ ] JWT authentication
- [ ] User CRUD operations
- [ ] PostgreSQL connection and migrations
- [ ] Docker Compose with PostgreSQL

**Key Patterns:**
- Repository pattern
- JWT authentication
- Database migrations

---

### Phase 2: Core Services (Weeks 3-4)

**Goals:**
- Post Service with CRUD
- Graph Service for follows
- gRPC communication between services

**Deliverables:**
- [ ] Post creation, deletion, retrieval
- [ ] Like/unlike functionality
- [ ] Follow/unfollow operations
- [ ] Followers/following lists
- [ ] gRPC proto definitions
- [ ] Inter-service communication

**Key Patterns:**
- gRPC unary calls
- Database transactions
- Optimistic locking for counters

---

### Phase 3: Event Streaming (Weeks 5-6)

**Goals:**
- Kafka integration
- Event-driven communication
- Transactional outbox pattern

**Deliverables:**
- [ ] Kafka setup (Docker)
- [ ] Event producers in Post/Graph services
- [ ] Event consumers
- [ ] Outbox pattern implementation
- [ ] Idempotent consumers

**Key Patterns:**
- Transactional outbox
- Event sourcing basics
- Consumer groups
- Exactly-once semantics

---

### Phase 4: Timeline & Caching (Weeks 7-8)

**Goals:**
- Timeline Service
- Redis integration
- Fan-out on write

**Deliverables:**
- [ ] Redis cluster setup
- [ ] Timeline fan-out implementation
- [ ] Home timeline API
- [ ] User timeline API
- [ ] Cache-aside for users/posts
- [ ] Write-through for timelines

**Key Patterns:**
- Fan-out on write
- Sorted sets for timelines
- Cache invalidation
- Hybrid push/pull model

---

### Phase 5: Notifications & Real-time (Weeks 9-10)

**Goals:**
- Notification Service
- WebSocket connections
- Real-time delivery

**Deliverables:**
- [ ] Notification creation and storage
- [ ] Event consumption for notifications
- [ ] WebSocket gateway
- [ ] Redis Pub/Sub integration
- [ ] Real-time notification push
- [ ] Notification preferences

**Key Patterns:**
- Redis Pub/Sub
- WebSocket with NestJS
- Notification aggregation

---

### Phase 6: Search & Discovery (Weeks 11-12)

**Goals:**
- Search Service
- Elasticsearch integration
- Full-text search

**Deliverables:**
- [ ] Elasticsearch setup
- [ ] User search
- [ ] Post search
- [ ] Hashtag search
- [ ] Trending hashtags
- [ ] Real-time indexing

**Key Patterns:**
- Full-text search
- Relevance scoring
- Real-time indexing

---

### Phase 7: Reliability & Security (Weeks 13-14)

**Goals:**
- Circuit breakers
- Rate limiting
- Health checks
- Security hardening

**Deliverables:**
- [ ] Circuit breaker implementation
- [ ] Rate limiting (token bucket)
- [ ] Health check endpoints
- [ ] Input validation
- [ ] mTLS between services
- [ ] Security headers

**Key Patterns:**
- Circuit breaker
- Token bucket rate limiting
- Health checks

---

### Phase 8: Observability (Weeks 15-16)

**Goals:**
- Logging infrastructure
- Metrics collection
- Distributed tracing

**Deliverables:**
- [ ] Structured logging
- [ ] Prometheus metrics
- [ ] Grafana dashboards
- [ ] Jaeger tracing
- [ ] Alert rules
- [ ] Log aggregation

**Key Patterns:**
- Structured logging
- RED metrics
- Trace context propagation

---

### Phase 9: Kubernetes Deployment (Weeks 17-18)

**Goals:**
- Kubernetes manifests
- CI/CD pipeline
- Production configuration

**Deliverables:**
- [ ] Deployment manifests
- [ ] Service definitions
- [ ] ConfigMaps and Secrets
- [ ] HPA configuration
- [ ] Ingress setup
- [ ] GitHub Actions CI/CD
- [ ] Helm charts (optional)

**Key Patterns:**
- Kubernetes deployments
- Horizontal scaling
- Rolling updates

---

### Phase 10: Performance & Polish (Weeks 19-20)

**Goals:**
- Load testing
- Performance optimization
- Documentation

**Deliverables:**
- [ ] Load tests (k6/Artillery)
- [ ] Performance bottleneck fixes
- [ ] API documentation (Swagger)
- [ ] Architecture documentation
- [ ] README and setup guides
- [ ] Demo video/presentation

---

## Appendix A: Technology Versions

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 20 LTS | Runtime |
| NestJS | 10.x | Framework |
| TypeScript | 5.x | Language |
| PostgreSQL | 16 | Primary database |
| Redis | 7.x | Caching, pub/sub |
| Apache Kafka | 3.6 | Event streaming |
| Elasticsearch | 8.x | Search engine |
| Kubernetes | 1.28+ | Orchestration |
| Docker | 24.x | Containerization |
| gRPC | 1.60+ | Inter-service communication |

---

## Appendix B: Repository Structure

```
social-backend/
├── apps/
│   ├── api-gateway/
│   ├── user-service/
│   ├── post-service/
│   ├── timeline-service/
│   ├── graph-service/
│   ├── notification-service/
│   └── search-service/
├── libs/
│   ├── common/              # Shared utilities
│   ├── proto/               # gRPC definitions
│   ├── database/            # Database utilities
│   ├── kafka/               # Kafka utilities
│   └── redis/               # Redis utilities
├── proto/
│   ├── user.proto
│   ├── post.proto
│   ├── graph.proto
│   ├── timeline.proto
│   ├── notification.proto
│   └── search.proto
├── k8s/
│   ├── base/
│   └── overlays/
│       ├── development/
│       ├── staging/
│       └── production/
├── docker/
│   ├── docker-compose.yml
│   └── docker-compose.prod.yml
├── scripts/
│   ├── setup.sh
│   ├── migrate.sh
│   └── seed.sh
├── docs/
│   ├── architecture.md
│   ├── api-reference.md
│   └── deployment.md
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── cd.yml
├── nest-cli.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Appendix C: Interview Talking Points

### System Design Questions

1. **"How do you generate a user's timeline?"**
   - Explain fan-out on write vs fan-out on read
   - Hybrid approach for celebrities
   - Redis sorted sets for storage
   - Cursor-based pagination

2. **"How do you handle a viral post?"**
   - Rate limiting on fan-out
   - Lazy loading for large follower counts
   - Cache warming strategies
   - Async processing with Kafka

3. **"How do you ensure messages aren't lost?"**
   - Transactional outbox pattern
   - Idempotent consumers
   - Dead letter queues
   - Exactly-once semantics

4. **"How do you scale the system?"**
   - Horizontal scaling with Kubernetes
   - Database sharding by user_id
   - Kafka partitioning
   - Redis cluster

### Backend Engineering Questions

1. **"Explain your caching strategy"**
   - Cache-aside for read-heavy data
   - Write-through for timelines
   - Cache invalidation on updates
   - TTL policies

2. **"How do you handle distributed transactions?"**
   - Saga pattern for multi-service operations
   - Compensating transactions
   - Event-driven consistency
   - Outbox pattern

3. **"How do you secure inter-service communication?"**
   - mTLS between services
   - Service mesh considerations
   - API gateway authentication
   - Rate limiting

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2024-01-15 | - | Initial design document |

---

**End of Design Document**

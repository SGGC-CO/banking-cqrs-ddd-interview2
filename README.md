# Banking App — DDD + CQRS + Event Sourcing Interview Project

## Project Overview
This is an intentionally incomplete banking application project for senior developer interviews. 
The project focuses on CQRS (Command Query Responsibility Segregation), DDD (Domain-Driven Design), 
and Event Sourcing patterns implemented from scratch (without using @nestjs/cqrs).

## Key Concepts

- **CQRS**: Separation of command and query models
- **DDD**: Domain-driven design principles with aggregates
- **Event Sourcing**: Storing all changes to application state as a sequence of events
- **Aggregates**: Cluster of domain objects treated as a unit
- **Domain Events**: Represent something that happened in the domain

## Project Structure
```
src/
  libs/
    cqrs/             # Custom CQRS implementation
  modules/
    accounts/         # Banking accounts module
      application/    # Application layer (commands, queries, handlers)
      domain/         # Domain layer (aggregates, events)
      http/           # Controllers and DTOs
      infra/          # Infrastructure (event store, projections)
    admin/            # Administrative module
```

## Installation

```bash
$ npm install
```

## Running the app

```bash
$ npm run start:dev
```

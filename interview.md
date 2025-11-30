# Banking CQRS/DDD/Event Sourcing Interview Guide

## Project Overview
This project is an incomplete banking application using NestJS that implements:
- Custom CQRS pattern (not using @nestjs/cqrs)
- Domain-Driven Design principles
- Event Sourcing for data persistence

## Interview Questions & Tasks

### Architecture Understanding
1. Explain the overall architecture of this application
2. What is the role of the Aggregate Root in this design?
3. Describe the event flow from HTTP controller to event store
4. How is the separation of command and query models achieved?
5. What are the benefits of using Event Sourcing in this banking application?

### Code Review
1. Review the Account aggregate implementation
2. Identify missing or incomplete parts of the codebase
3. How would you improve error handling in the command handlers?
4. What's the purpose of the EventBus in this architecture?

### Implementation Tasks
1. Complete the withdraw method in the Account aggregate to prevent overdrafts
2. Implement the withdraw handler to properly use the Account aggregate
3. Implement the missing methods in the CommandBus class
4. Add proper event handling for WithdrawnEvent in the projection system
5. Implement the static rehydrate method in the AggregateRoot class

### Advanced Questions
1. How would you handle eventual consistency in this design?
2. What challenges do you anticipate with this architecture at scale?
3. How would you implement event versioning for long-living aggregates?
4. What testing strategy would you recommend for this system?
5. How would you handle compensating transactions when operations fail?

### System Design Extension
1. How would you integrate this with an external payment system?
2. Design a solution for handling distributed transactions
3. How would you implement an audit log requirement?
4. What would you change to support multiple currencies and exchange rates?

## Evaluation Criteria
- Understanding of CQRS, DDD, and Event Sourcing concepts
- Code quality and design principles
- Problem-solving approach
- Knowledge of trade-offs and architectural implications
- Ability to identify and implement missing parts of the system
- Communication about complex architectural patterns

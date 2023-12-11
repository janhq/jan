# jan-001: Application Logs Framework

| Proposal   | jan-001                                               |
| ---------- | ----------------------------------------------------- |
| Title      | App Logging                                           |
| Authors    | @louis-jan                                            |
| Permalink  |                                                       |
| Discussion | [issue #528](https://github.com/janhq/jan/issues/528) |
| Status     | Idea                                                  |

## Changelog

| Date         | Author     | Changes       |
| ------------ | ---------- | ------------- |
| Nov 2nd 2023 | @louis-jan | Initial Draft |

## Summary

This proposal suggests the implementation of an "App logging as file and log window" feature, which aims to address the problem of limited visibility into the operation of a production application. Currently, logs (info, verbose, error) are hidden, making it challenging for both users and developers to debug and support the application. The proposed solution involves logging application-wide activities to a file while also enabling real-time log monitoring through a dedicated log window within the application.

## Motivation

### Problem Description
The lack of proper logging in production applications results in several challenges:

1. Debugging Difficulty: When an issue arises in a production environment, developers have limited access to essential information about what happened, making it challenging to diagnose and resolve problems effectively.
2. Support Challenges: Users often encounter errors or unexpected behavior, and support teams struggle to gather the necessary logs to understand the issue and provide a solution promptly.
3. Lack of Real-time Insights: Real-time monitoring is essential for identifying and responding to critical events. The absence of a log window within the application prevents timely reactions to events.

### Use Case Example
Consider an e-commerce application. In the current state, when a user faces an issue during checkout, there's no easy way for support or development teams to see what went wrong in real time. This results in frustration for the user and a loss of business for the company

```ts
# Current Status (Without the Feature)
try:
    # Checkout logic
    # ...
except Exception as e:
    # Error handling
    console.log(err)
    # Insufficient logging
```

Without proper logging, it is challenging to diagnose the issue and provide immediate assistance.

## Proposed solution

### High-level overview
The proposed solution introduces the following key changes:

1. Application-wide Logging: Implement a logging mechanism that logs application-wide activities to a designated log file. This ensures that all relevant information is captured for later analysis and debugging.
2. Real-time Log Window: Create a log window within the application that displays log entries in real time. Users and developers can open this window to monitor logs, allowing them to react promptly to events and errors.

```ts
# With the Proposed Feature
try:
    # Checkout logic
    # ...
except Exception as e:
    # Error handling
    log.error(f"Error when downloading model: {e}")
    # Proper logging

```

![Image](https://github.com/janhq/jan/assets/133622055/b60f6976-8138-438e-aa4f-7e103037e124)


### Specification

- The logging system will support different log levels (e.g., info, verbose, error) to ensure that the right level of detail is captured.
- Log entries will be timestamped and categorized to aid in the analysis and debugging process.
- The log window will provide options for filtering and searching log entries for ease of use.


### Compatibility

This proposal aims to preserve backward compatibility by ensuring that the new logging system does not break existing functionality or affect existing applications negatively. It should not alter the semantics of valid programs.


### Other concerns

- Implementation: Careful consideration should be given to the choice of logging framework and implementation details.
- Security: Access to logs and log window functionality should be restricted to authorized users to prevent potential security risks.

### Open questions

- What will be the default log file location, and how will it be configurable?
- Should log entries be persisted and rotated over time to prevent excessive file size?

## Alternatives

Alternative approaches may involve integrating with existing third-party logging systems or cloud-based log management platforms. However, this proposal focuses on a built-in solution for application-wide logging and real-time monitoring.

## Related work

This proposal is inspired by similar features in various application development frameworks and tools.

## FAQ

No frequently asked questions at this time.
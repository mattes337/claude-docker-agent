# General
- run the backend on a server with docker installed
- for each session opened use a docker container dynamically started and monitored by the backend
- expose the docker api to the backend
- for each session use a base image - create the Dockerfile for state (Dockerfile.session)
- a session can refer to any git server, be it gitlab self hosted or github or any other

[user] --(controls)--> [webui] --(commands)--> [backend] --(managed)--> [docker-api]

# WebUI
- the user sees all sessions
- the user can start a new session, force stop sessions, monitor the log output of a session
- the user will receive notifications when a session is complete or halted
- important: it must be visible immediately which session requires manual intervention (== halted)

# Session container
- Has auth tokens for git servers
- Has claude installed
- Has git installed
- question: one image per dev stack? python, typescript, c#?
-- this way we can install all the MCP we need in the image directly
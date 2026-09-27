"""Typed errors that surface as actionable messages in MCP tool results."""

from __future__ import annotations


class MotionWorksError(Exception):
    """Base class for every failure this package reports to an agent."""


class ProjectNotFound(MotionWorksError):
    """The requested project could not be resolved to an expanded directory."""


class AmbiguousProject(MotionWorksError):
    """A bare project name matched more than one project on disk."""


class IdeRunning(MotionWorksError):
    """MotionWorks IEC is open, so writing would be unsafe.

    The IDE caches project state in memory and rewrites whole files on save, so
    an external edit made while it is open will either be silently discarded or
    produce an inconsistent project.
    """


class UnsupportedFormat(MotionWorksError):
    """The on-disk format differs from the versions this package understands."""


class VerificationFailed(MotionWorksError):
    """A post-write read-back did not match what was written."""


class NotFound(MotionWorksError):
    """A named POU, variable, or file does not exist in the project."""

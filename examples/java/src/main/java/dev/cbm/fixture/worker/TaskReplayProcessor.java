package dev.cbm.fixture.worker;

import dev.cbm.fixture.model.TaskMode;

public final class TaskReplayProcessor {
  public boolean shouldReplay(TaskMode mode) {
    return mode == TaskMode.SAFE;
  }
}

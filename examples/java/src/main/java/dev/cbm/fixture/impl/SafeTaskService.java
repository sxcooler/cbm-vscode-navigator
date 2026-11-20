package dev.cbm.fixture.impl;

import dev.cbm.fixture.api.TaskService;
import dev.cbm.fixture.model.TaskRequest;

public final class SafeTaskService implements TaskService {
  @Override
  public String execute(TaskRequest request) {
    return "safe:" + request.name();
  }

  @Override
  public String status() {
    return "ready";
  }
}

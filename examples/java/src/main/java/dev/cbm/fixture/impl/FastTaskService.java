package dev.cbm.fixture.impl;

import dev.cbm.fixture.api.TaskService;
import dev.cbm.fixture.model.TaskRequest;

public final class FastTaskService implements TaskService {
  public FastTaskService() {}

  @Override
  public String execute(TaskRequest request) {
    return "fast:" + request.name();
  }

  @Override
  public String status() {
    return "ready";
  }
}

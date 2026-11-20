package dev.cbm.fixture.web;

import dev.cbm.fixture.api.TaskService;
import dev.cbm.fixture.model.TaskRequest;
import static dev.cbm.fixture.support.TaskRequests.normalize;

public final class TaskController {
  private final TaskService taskService;
  private int invocationCount;

  public TaskController(TaskService taskService) {
    this.taskService = taskService;
  }

  public String submit(TaskRequest request) {
    int local = 1;
    String result = taskService.execute(normalize(request)); taskService.status();
    invocationCount += local;
    return result;
  }
}

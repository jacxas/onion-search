"""`python -m health_checker` — barrido de salud único."""
from health_checker.checker import run_health_sweep

if __name__ == '__main__':
    print(run_health_sweep())

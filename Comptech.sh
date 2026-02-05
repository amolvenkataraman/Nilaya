#!/bin/bash

SESSION=Comptech
WORKDIR=/opt/Comptech
VENV=$WORKDIR/CT_env/bin/activate

# Start new tmux session in detached mode
tmux new-session -d -s "$SESSION" -n main

# Window 0: cd, activate venv, run program
tmux send-keys -t "$SESSION:0" "cd $WORKDIR" C-m
tmux send-keys -t "$SESSION:0" "source $VENV" C-m
tmux send-keys -t "$SESSION:0" "make" C-m

# Window 1: ...
tmux new-window -t "$SESSION:1" -n idle
tmux send-keys -t "$SESSION:1" "cd $WORKDIR" C-m
tmux send-keys -t "$SESSION:1" "source $VENV" C-m

# Window 2: ...
tmux new-window -t "$SESSION:2" -n idle
tmux send-keys -t "$SESSION:2" "cd $WORKDIR" C-m
tmux send-keys -t "$SESSION:2" "source $VENV" C-m
tmux send-keys -t "$SESSION:2" "export DJANGO_SETTINGS_MODULE=$SESSION.settings" C-m
tmux send-keys -t "$SESSION:2" "$WORKDIR/CT_env/bin/celery -A $SESSION worker --loglevel=info --concurrency=4" C-m

# Window 3: ...
tmux new-window -t "$SESSION:3" -n idle
tmux send-keys -t "$SESSION:3" "cd $WORKDIR" C-m
tmux send-keys -t "$SESSION:3" "export DJANGO_SETTINGS_MODULE=$SESSION.settings" C-m
tmux send-keys -t "$SESSION:3" "source $VENV" C-m
tmux send-keys -t "$SESSION:3" "$WORKDIR/CT_env/bin/celery -A $SESSION beat --loglevel=info" C-m

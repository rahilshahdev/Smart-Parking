# Makefile for Smart Parking C Engine Shared Library (.dll)

CC = gcc
CFLAGS = -Wall -Wextra -O2 -DBUILDING_PARKING_DLL -shared
TARGET = parking_engine.dll
SRC = parking_engine.c

all: $(TARGET)

$(TARGET): $(SRC) parking_engine.h
	$(CC) $(CFLAGS) -o $(TARGET) $(SRC)

clean:
	rm -f $(TARGET)

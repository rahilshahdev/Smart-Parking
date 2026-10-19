#ifndef PARKING_ENGINE_H
#define PARKING_ENGINE_H

#include <time.h>

#ifdef _WIN32
    #ifdef BUILDING_PARKING_DLL
        #define PARKING_API __declspec(dllexport)
    #else
        #define PARKING_API __declspec(dllimport)
    #endif
#else
    #define PARKING_API
#endif

#define MAX_SLOTS 64
#define MAX_LOG_ENTRIES 256
#define LABEL_LEN 16
#define LOG_MSG_LEN 128

typedef struct {
    int id;
    char label[LABEL_LEN];
    int is_occupied;            /* 0 = Available (Green), 1 = Occupied (Red) */
    time_t occupied_since;      /* Timestamp when occupancy started */
    double current_duration;    /* Active parking duration in seconds */
    double accumulated_duration;/* Total lifetime parked seconds */
    int occupancy_count;        /* Times parked */
    double accrued_fee;         /* Cost for current session */
    int x;                      /* Bounding box on frame */
    int y;
    int width;
    int height;
} ParkingSlot;

typedef struct {
    char timestamp[32];
    int slot_id;
    char slot_label[LABEL_LEN];
    char event_type[16];        /* "PARKED", "UNPARKED", "ALERT" */
    double duration_sec;
    double fee;
} ParkingEventLog;

typedef struct {
    int total_slots;
    int occupied_count;
    int available_count;
    double occupancy_pct;
    double hourly_rate;
    double total_revenue;
    ParkingSlot slots[MAX_SLOTS];
    ParkingEventLog logs[MAX_LOG_ENTRIES];
    int log_count;
} ParkingLot;

/* Core Engine API Exports */
#ifdef __cplusplus
extern "C" {
#endif

PARKING_API int engine_init(int initial_slots, double hourly_rate);
PARKING_API int engine_configure_slot(int slot_id, const char* label, int x, int y, int w, int h);
PARKING_API int engine_update_slot_state(int slot_id, int is_occupied);
PARKING_API int engine_get_slot(int slot_id, ParkingSlot* out_slot);
PARKING_API int engine_get_total_slots(void);
PARKING_API int engine_get_occupied_count(void);
PARKING_API int engine_get_available_count(void);
PARKING_API double engine_get_occupancy_rate(void);
PARKING_API double engine_get_total_revenue(void);
PARKING_API int engine_find_nearest_available_slot(void);
PARKING_API int engine_set_hourly_rate(double new_rate);
PARKING_API double engine_get_hourly_rate(void);
PARKING_API int engine_save_state(const char* filepath);
PARKING_API int engine_load_state(const char* filepath);
PARKING_API int engine_get_log_count(void);
PARKING_API int engine_get_log(int index, ParkingEventLog* out_log);
PARKING_API void engine_reset_all(void);

#ifdef __cplusplus
}
#endif

#endif /* PARKING_ENGINE_H */

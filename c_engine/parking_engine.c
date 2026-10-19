#define BUILDING_PARKING_DLL
#include "parking_engine.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

static ParkingLot g_lot;

static void format_current_timestamp(char* buffer, size_t max_len) {
    time_t now = time(NULL);
    struct tm* tm_info = localtime(&now);
    if (tm_info) {
        strftime(buffer, max_len, "%Y-%m-%d %H:%M:%S", tm_info);
    } else {
        snprintf(buffer, max_len, "unknown-time");
    }
}

static void add_event_log(int slot_id, const char* label, const char* event_type, double duration_sec, double fee) {
    if (g_lot.log_count >= MAX_LOG_ENTRIES) {
        /* Shift logs to keep newest entries */
        memmove(&g_lot.logs[0], &g_lot.logs[1], sizeof(ParkingEventLog) * (MAX_LOG_ENTRIES - 1));
        g_lot.log_count = MAX_LOG_ENTRIES - 1;
    }
    ParkingEventLog* entry = &g_lot.logs[g_lot.log_count++];
    format_current_timestamp(entry->timestamp, sizeof(entry->timestamp));
    entry->slot_id = slot_id;
    strncpy(entry->slot_label, label ? label : "Unknown", sizeof(entry->slot_label) - 1);
    entry->slot_label[sizeof(entry->slot_label) - 1] = '\0';
    strncpy(entry->event_type, event_type, sizeof(entry->event_type) - 1);
    entry->event_type[sizeof(entry->event_type) - 1] = '\0';
    entry->duration_sec = duration_sec;
    entry->fee = fee;
}

PARKING_API int engine_init(int initial_slots, double hourly_rate) {
    memset(&g_lot, 0, sizeof(ParkingLot));
    if (initial_slots > MAX_SLOTS) initial_slots = MAX_SLOTS;
    if (initial_slots < 0) initial_slots = 0;
    
    g_lot.total_slots = initial_slots;
    g_lot.hourly_rate = (hourly_rate > 0.0) ? hourly_rate : 5.0; /* default $5.00/hr */
    g_lot.occupied_count = 0;
    g_lot.available_count = initial_slots;
    g_lot.occupancy_pct = 0.0;
    g_lot.total_revenue = 0.0;
    g_lot.log_count = 0;

    for (int i = 0; i < initial_slots; ++i) {
        g_lot.slots[i].id = i;
        snprintf(g_lot.slots[i].label, sizeof(g_lot.slots[i].label), "P%d", i + 1);
        g_lot.slots[i].is_occupied = 0;
        g_lot.slots[i].occupied_since = 0;
        g_lot.slots[i].current_duration = 0.0;
        g_lot.slots[i].accumulated_duration = 0.0;
        g_lot.slots[i].occupancy_count = 0;
        g_lot.slots[i].accrued_fee = 0.0;
        g_lot.slots[i].x = 50 + (i % 4) * 140;
        g_lot.slots[i].y = 50 + (i / 4) * 180;
        g_lot.slots[i].width = 110;
        g_lot.slots[i].height = 150;
    }

    add_event_log(-1, "SYSTEM", "INITIALIZED", 0.0, 0.0);
    return 1;
}

PARKING_API int engine_configure_slot(int slot_id, const char* label, int x, int y, int w, int h) {
    if (slot_id < 0 || slot_id >= MAX_SLOTS) return 0;
    if (slot_id >= g_lot.total_slots) {
        g_lot.total_slots = slot_id + 1;
    }

    ParkingSlot* s = &g_lot.slots[slot_id];
    s->id = slot_id;
    if (label && strlen(label) > 0) {
        strncpy(s->label, label, sizeof(s->label) - 1);
        s->label[sizeof(s->label) - 1] = '\0';
    }
    s->x = x;
    s->y = y;
    s->width = w;
    s->height = h;
    return 1;
}

PARKING_API int engine_update_slot_state(int slot_id, int is_occupied) {
    if (slot_id < 0 || slot_id >= g_lot.total_slots) return 0;

    ParkingSlot* s = &g_lot.slots[slot_id];
    int prev_occupied = s->is_occupied;
    time_t now = time(NULL);

    /* State transition from Available (0) -> Occupied (1) */
    if (!prev_occupied && is_occupied) {
        s->is_occupied = 1;
        s->occupied_since = now;
        s->current_duration = 0.0;
        s->accrued_fee = 0.0;
        s->occupancy_count++;
        add_event_log(s->id, s->label, "PARKED", 0.0, 0.0);
    }
    /* State transition from Occupied (1) -> Available (0) */
    else if (prev_occupied && !is_occupied) {
        double duration = 0.0;
        if (s->occupied_since > 0) {
            duration = difftime(now, s->occupied_since);
        }
        if (duration < 0.0) duration = 0.0;
        
        /* Calculate fee based on hourly rate (minimum 1 min rounded) */
        double fee = (duration / 3600.0) * g_lot.hourly_rate;
        if (duration > 5.0 && fee < 0.10) {
            fee = 0.10; /* nominal min */
        }
        
        s->is_occupied = 0;
        s->accumulated_duration += duration;
        s->current_duration = 0.0;
        s->accrued_fee = 0.0;
        s->occupied_since = 0;
        g_lot.total_revenue += fee;

        add_event_log(s->id, s->label, "UNPARKED", duration, fee);
    }
    /* Currently occupied: update duration & fee */
    else if (prev_occupied && is_occupied) {
        if (s->occupied_since > 0) {
            s->current_duration = difftime(now, s->occupied_since);
            s->accrued_fee = (s->current_duration / 3600.0) * g_lot.hourly_rate;
        }
    }

    /* Recalculate summary metrics */
    int occupied = 0;
    for (int i = 0; i < g_lot.total_slots; ++i) {
        if (g_lot.slots[i].is_occupied) {
            occupied++;
        }
    }
    g_lot.occupied_count = occupied;
    g_lot.available_count = g_lot.total_slots - occupied;
    if (g_lot.total_slots > 0) {
        g_lot.occupancy_pct = ((double)occupied / (double)g_lot.total_slots) * 100.0;
    } else {
        g_lot.occupancy_pct = 0.0;
    }

    return 1;
}

PARKING_API int engine_get_slot(int slot_id, ParkingSlot* out_slot) {
    if (slot_id < 0 || slot_id >= g_lot.total_slots || !out_slot) return 0;
    
    ParkingSlot* s = &g_lot.slots[slot_id];
    if (s->is_occupied && s->occupied_since > 0) {
        time_t now = time(NULL);
        s->current_duration = difftime(now, s->occupied_since);
        s->accrued_fee = (s->current_duration / 3600.0) * g_lot.hourly_rate;
    }
    memcpy(out_slot, s, sizeof(ParkingSlot));
    return 1;
}

PARKING_API int engine_get_total_slots(void) {
    return g_lot.total_slots;
}

PARKING_API int engine_get_occupied_count(void) {
    return g_lot.occupied_count;
}

PARKING_API int engine_get_available_count(void) {
    return g_lot.available_count;
}

PARKING_API double engine_get_occupancy_rate(void) {
    return g_lot.occupancy_pct;
}

PARKING_API double engine_get_total_revenue(void) {
    return g_lot.total_revenue;
}

PARKING_API int engine_find_nearest_available_slot(void) {
    for (int i = 0; i < g_lot.total_slots; ++i) {
        if (!g_lot.slots[i].is_occupied) {
            return g_lot.slots[i].id;
        }
    }
    return -1; /* All occupied */
}

PARKING_API int engine_set_hourly_rate(double new_rate) {
    if (new_rate < 0.0) return 0;
    g_lot.hourly_rate = new_rate;
    return 1;
}

PARKING_API double engine_get_hourly_rate(void) {
    return g_lot.hourly_rate;
}

PARKING_API int engine_save_state(const char* filepath) {
    if (!filepath) return 0;
    FILE* fp = fopen(filepath, "wb");
    if (!fp) return 0;
    size_t written = fwrite(&g_lot, sizeof(ParkingLot), 1, fp);
    fclose(fp);
    return (written == 1) ? 1 : 0;
}

PARKING_API int engine_load_state(const char* filepath) {
    if (!filepath) return 0;
    FILE* fp = fopen(filepath, "rb");
    if (!fp) return 0;
    size_t read_bytes = fread(&g_lot, sizeof(ParkingLot), 1, fp);
    fclose(fp);
    return (read_bytes == 1) ? 1 : 0;
}

PARKING_API int engine_get_log_count(void) {
    return g_lot.log_count;
}

PARKING_API int engine_get_log(int index, ParkingEventLog* out_log) {
    if (index < 0 || index >= g_lot.log_count || !out_log) return 0;
    memcpy(out_log, &g_lot.logs[index], sizeof(ParkingEventLog));
    return 1;
}

PARKING_API void engine_reset_all(void) {
    double rate = g_lot.hourly_rate;
    int total = g_lot.total_slots;
    engine_init(total, rate);
}

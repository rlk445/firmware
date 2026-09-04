#include "core/powerSave.h"
#include "core/utils.h"
#include <Arduino.h>
#include <interface.h>

#ifndef TFT_BRIGHT_FREQ
#define TFT_BRIGHT_FREQ 5000
#endif
#ifndef TFT_BRIGHT_Bits
#define TFT_BRIGHT_Bits 8
#endif

#define XPT2046_CS TOUCH_CS

/***************************************************************************************
** Function name: _setup_gpio()
** Location: main.cpp
** Description:   initial setup for the device
***************************************************************************************/
void _setup_gpio() {
    pinMode(XPT2046_CS, OUTPUT);
    digitalWrite(XPT2046_CS, HIGH);
    bruceConfig.colorInverted = 0;
}

/***************************************************************************************
** Function name: _post_setup_gpio()
** Location: main.cpp
** Description:   second stage gpio setup (touch calibration + backlight)
***************************************************************************************/
void _post_setup_gpio() {
#if defined(USE_TFT_eSPI_TOUCH)
    pinMode(TOUCH_CS, OUTPUT);
    uint16_t calData[5];
    File caldata = LittleFS.open("/calData", "r");

    if (!caldata) {
        tft.setRotation(ROTATION);
        tft.calibrateTouch(calData, TFT_WHITE, TFT_BLACK, 10);

        caldata = LittleFS.open("/calData", "w");
        if (caldata) {
            caldata.printf(
                "%d\n%d\n%d\n%d\n%d\n", calData[0], calData[1], calData[2], calData[3], calData[4]
            );
            caldata.close();
        }
    } else {
        for (int i = 0; i < 5; i++) {
            String line = caldata.readStringUntil('\n');
            calData[i] = line.toInt();
        }
        caldata.close();
    }
    tft.setTouch(calData);
#endif

    pinMode(TFT_BL, OUTPUT);
    ledcAttach(TFT_BL, TFT_BRIGHT_FREQ, TFT_BRIGHT_Bits);
    ledcWrite(TFT_BL, 255);
}

/***************************************************************************************
** Function name: getBattery()
** Description:   sem circuito de bateria nesse setup
***************************************************************************************/
int getBattery() { return 0; }

bool isCharging() { return false; }

/*********************************************************************
** Function: setBrightness
**********************************************************************/
void _setBrightness(uint8_t brightval) {
    int dutyCycle;
    if (brightval == 100) dutyCycle = 255;
    else if (brightval == 75) dutyCycle = 130;
    else if (brightval == 50) dutyCycle = 70;
    else if (brightval == 25) dutyCycle = 20;
    else if (brightval == 0) dutyCycle = 0;
    else dutyCycle = ((brightval * 255) / 100);
    ledcWrite(TFT_BL, dutyCycle);
}

/*********************************************************************
** Function: InputHandler
**********************************************************************/
void InputHandler(void) {
    static long d_tmp = 0;
    if (millis() - d_tmp > 200 || LongPress) {
#if defined(USE_TFT_eSPI_TOUCH)
        TouchPoint t;
        checkPowerSaveTime();
        bool _IH_touched = tft.getTouch(&t.x, &t.y);
        if (_IH_touched) {
            NextPress = false;
            PrevPress = false;
            UpPress = false;
            DownPress = false;
            SelPress = false;
            EscPress = false;
            AnyKeyPress = false;
            NextPagePress = false;
            PrevPagePress = false;
            touchPoint.pressed = false;

            if (!wakeUpScreen()) AnyKeyPress = true;
            else goto END;

            touchPoint.x = t.x;
            touchPoint.y = t.y;
            touchPoint.pressed = true;
            touchHeatMap(touchPoint);
        END:
            d_tmp = millis();
        }
#endif
    }
}

/*********************************************************************
** Function: powerOff
**********************************************************************/
void powerOff() {
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_0, LOW);
    esp_deep_sleep_start();
}

void checkReboot() {}

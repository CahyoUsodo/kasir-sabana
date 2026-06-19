package com.kasirsabana.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetoothConnect")
    }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    @PluginMethod
    public void printRaw(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            requestAllPermissions(call, "bluetoothPermissionCallback");
            return;
        }

        printRawWithPermission(call);
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Izin Bluetooth ditolak.");
            return;
        }

        printRawWithPermission(call);
    }

    private void printRawWithPermission(PluginCall call) {
        String base64Data = call.getString("data");
        if (base64Data == null || base64Data.isEmpty()) {
            call.reject("Data cetak kosong.");
            return;
        }

        int chunkSize = call.getInt("chunkSize", 512);

        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) {
                    call.reject("Bluetooth tidak tersedia di perangkat ini.");
                    return;
                }

                if (!adapter.isEnabled()) {
                    call.reject("Bluetooth belum aktif.");
                    return;
                }

                BluetoothDevice device = selectPrinter(adapter.getBondedDevices());
                if (device == null) {
                    call.reject("Tidak ada printer Bluetooth yang sudah dipairing.");
                    return;
                }

                adapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();

                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                OutputStream outputStream = socket.getOutputStream();
                for (int offset = 0; offset < data.length; offset += chunkSize) {
                    int length = Math.min(chunkSize, data.length - offset);
                    outputStream.write(data, offset, length);
                    outputStream.flush();
                    Thread.sleep(20);
                }

                JSObject result = new JSObject();
                result.put("deviceName", device.getName());
                call.resolve(result);
            } catch (Exception exception) {
                call.reject("Gagal mencetak via Bluetooth native: " + exception.getMessage(), exception);
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
            }
        }).start();
    }

    private BluetoothDevice selectPrinter(Set<BluetoothDevice> bondedDevices) {
        if (bondedDevices == null || bondedDevices.isEmpty()) {
            return null;
        }

        BluetoothDevice fallback = null;
        for (BluetoothDevice device : bondedDevices) {
            if (fallback == null) {
                fallback = device;
            }

            String name = device.getName();
            if (name == null) {
                continue;
            }

            String lowerName = name.toLowerCase();
            if (
                lowerName.contains("printer") ||
                lowerName.contains("thermal") ||
                lowerName.contains("pos") ||
                lowerName.contains("rpp") ||
                lowerName.contains("mtp")
            ) {
                return device;
            }
        }

        return fallback;
    }
}

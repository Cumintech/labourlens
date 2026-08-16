import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import LoginScreen from "../screens/LoginScreen";
import PlaceholderScreen from "../screens/PlaceholderScreen";

export type RootStackParamList = {
  Dashboard: undefined;
  WorkerList: undefined;
  NewWorkerScan: undefined;
  MarkAttendance: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Dashboard">
        <Stack.Screen name="Dashboard" options={{ title: "Dashboard" }}>
          {() => <PlaceholderScreen title="Dashboard" day="Day 4" />}
        </Stack.Screen>
        <Stack.Screen name="WorkerList" options={{ title: "Workers" }}>
          {() => <PlaceholderScreen title="Worker List · Search" day="Day 2 / Day 4" />}
        </Stack.Screen>
        <Stack.Screen name="NewWorkerScan" options={{ title: "New Worker" }}>
          {() => <PlaceholderScreen title="New Worker — Scan" day="Day 2" />}
        </Stack.Screen>
        <Stack.Screen name="MarkAttendance" options={{ title: "Mark Attendance" }}>
          {() => <PlaceholderScreen title="Mark Attendance" day="Day 4" />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

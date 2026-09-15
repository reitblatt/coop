# Coop resource measurement — heapcap-512

Host: 8 cpu / 14.9 GiB · node v24.20.0 · 2026-09-15T17:58:47.099Z

## Startup

| metric | value |
| --- | --- |
| bootToReadyMs | 2748 |

## Processes — graphql

Total RSS: mean 482.4 MiB, max 579.4 MiB, trend -162.45 MiB/min over 30.4s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 2 | 241.2 | 329.7 | 201.2 | 11 | 55 | 25 | -81.22 |

## Processes — idle

Total RSS: mean 568.5 MiB, max 568.6 MiB, trend 0.16 MiB/min over 60.7s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 2 | 284.3 | 314.1 | 248.8 | 11 | 27 | 0.9 | 0.08 |

## Processes — ingest

Total RSS: mean 506.2 MiB, max 736.8 MiB, trend -780.18 MiB/min over 30.7s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 2 | 291.4 | 614.1 | 257.2 | 11 | 70 | 67.1 | -105.01 |

## Processes — ready

Total RSS: mean 568.7 MiB, max 568.8 MiB, trend 0.59 MiB/min over 30.3s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 2 | 284.3 | 314.3 | 244.9 | 11 | 51 | 1.1 | 0.29 |

## Processes — settle

Total RSS: mean 102.4 MiB, max 102.6 MiB, trend 0.19 MiB/min over 120.9s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 1 | 102.4 | 102.6 | 86.3 | 11 | 29 | 0.4 | 0.19 |

## Processes — soak

Total RSS: mean 163.1 MiB, max 210.1 MiB, trend -51.97 MiB/min over 180.6s

| process | n | rss mean | rss max | pss mean | threads | fds | cpu s | rss trend MiB/min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| node | 1 | 163.1 | 210.1 | 138.4 | 11 | 29 | 0.6 | -51.97 |

## Containers — graphql

Total: 3886.1 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2435.7 | 2463.7 | 24.2 | 915 |
| coop-hma-1 | 54.3 | 56.1 | 0.2 | 22 |
| coop-jaeger-1 | 29.2 | 29.8 | 0 | 13 |
| coop-otel-collector-1 | 72.9 | 73.4 | 0 | 13 |
| coop-postgres-1 | 27.8 | 29.7 | 50.2 | 14 |
| coop-redis-1 | 6.2 | 9.5 | 1.3 | 14 |
| coop-scylla-1 | 1260 | 1291.3 | 2.9 | 58 |

## Containers — idle

Total: 3784.6 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2404.4 | 2467.8 | 5.9 | 915 |
| coop-hma-1 | 49.6 | 50.1 | 0.2 | 22 |
| coop-jaeger-1 | 29 | 29.1 | 0 | 13 |
| coop-otel-collector-1 | 72.5 | 73.1 | 0.1 | 13 |
| coop-postgres-1 | 16.2 | 16.7 | 2.2 | 10 |
| coop-redis-1 | 5.4 | 5.7 | 1.2 | 8 |
| coop-scylla-1 | 1207.5 | 1214.5 | 5.7 | 58 |

## Containers — ingest

Total: 4148.1 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2685.2 | 3010.6 | 156.9 | 915 |
| coop-hma-1 | 47.6 | 56.3 | 0.2 | 22 |
| coop-jaeger-1 | 21.9 | 29.5 | 0 | 13 |
| coop-otel-collector-1 | 34.8 | 90.4 | 0.3 | 13 |
| coop-postgres-1 | 44.3 | 58.8 | 22.1 | 17 |
| coop-redis-1 | 12.1 | 18 | 3 | 6 |
| coop-scylla-1 | 1302.2 | 1571.8 | 40.8 | 57 |

## Containers — ready

Total: 3816.5 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2423.8 | 2449.4 | 21.2 | 915 |
| coop-hma-1 | 50.2 | 51.8 | 0.2 | 22 |
| coop-jaeger-1 | 29 | 29.2 | 0 | 13 |
| coop-otel-collector-1 | 72.9 | 73.1 | 0 | 13 |
| coop-postgres-1 | 17.1 | 21 | 1.5 | 16 |
| coop-redis-1 | 5.5 | 6.1 | 1.3 | 8 |
| coop-scylla-1 | 1218 | 1232.9 | 15.3 | 56 |

## Containers — settle

Total: 4134.2 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2005 | 2056.2 | 4.3 | 915 |
| coop-hma-1 | 49.4 | 50 | 0.2 | 22 |
| coop-jaeger-1 | 52.5 | 52.7 | 0 | 13 |
| coop-otel-collector-1 | 74 | 74.4 | 0 | 13 |
| coop-postgres-1 | 32.2 | 33.4 | 1.9 | 11 |
| coop-redis-1 | 21 | 21.4 | 1.2 | 6 |
| coop-scylla-1 | 1900.1 | 1907.7 | 3.1 | 58 |

## Containers — soak

Total: 4413.3 MiB

| container | mem mean MiB | mem max MiB | cpu % mean | pids |
| --- | --- | --- | --- | --- |
| coop-clickhouse-1 | 2341.4 | 2705.4 | 12.5 | 915 |
| coop-hma-1 | 49.4 | 59.5 | 0.2 | 22 |
| coop-jaeger-1 | 48.4 | 52.7 | 0 | 13 |
| coop-otel-collector-1 | 65.5 | 74.6 | 0 | 13 |
| coop-postgres-1 | 32.6 | 33.5 | 1.4 | 12 |
| coop-redis-1 | 18.7 | 24.2 | 1.2 | 12 |
| coop-scylla-1 | 1857.3 | 1940.5 | 7 | 58 |

## In-process heap — probe-server

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 47.4 | 606.9 | 625.2 | |
| heapUsed MiB | 4.8 | 495.3 | 496.7 | 79.64 |
| external MiB | 2 | 25.5 | 38.9 | |
| handles | | | 48 | |

## In-process heap — probe-worker

| metric | first | last | max | trend/min |
| --- | --- | --- | --- | --- |
| rss MiB | 47.4 | 102.7 | 254.2 | |
| heapUsed MiB | 4.8 | 50.9 | 90.9 | -1.15 |
| external MiB | 2 | 4.6 | 5.7 | |
| handles | | | 17 | |

## Load phases

| phase | scenario | conc | rps | p50 ms | p90 ms | p99 ms | errors | statuses |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| graphql | graphql-me | 25 | 994.5 | 24.48 | 28.93 | 36.42 | 0 | {"200":29855} |
| ingest | items-async | 25 | 1883.5 | 2.52 | 26.61 | 238.17 | 48816 | {"202":7692,"err:ECONNRESET":25,"err:ECONNREFUSED":48791} |
| ready | ready | 25 | 24.9 | 1001.41 | 1003.23 | 1011.44 | 0 | {"200":750} |
| soak | mixed | 25 | 13366 | 1.71 | 2.07 | 6.58 | 2405901 | {"err:ECONNREFUSED":2405901} |

## Disk footprint

| item | MiB |
| --- | --- |
| rootNodeModulesMib | 120 |
| serverNodeModulesMib | 389 |
| clientNodeModulesMib | 700 |
| dbNodeModulesMib | 93 |
| migratorNodeModulesMib | 86 |
| nodeModulesTotalMib | 1388 |
| serverTranspiledMib | 9 |
| clientBuildMib | 0 |
| checkoutMib | 3388 |
| serverPackages | 1330 |
| clientPackages | 878 |
| rootPackages | 326 |
| imageServerMib | 590 |
| imageServerBaseMib | 876 |
| imageClientMib | 1091 |

